import express from "express";
import cors from "cors";
import multer from "multer";
import axios from "axios";
// Apillon SDK handles uploads; axios/form-data no longer required for uploads
import { ethers } from "ethers";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import { uploadToPinata } from "./utils/pinata.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 4000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
const GANACHE_RPC_URL = process.env.GANACHE_RPC_URL || "http://127.0.0.1:7545";
let contractAddress = process.env.CONTRACT_ADDRESS;
const SIGNER_PRIVATE_KEY = process.env.SIGNER_PRIVATE_KEY;

const contractArtifactPath = path.join(__dirname, "contract.json");
let contractAbi = [];
try {
  if (fs.existsSync(contractArtifactPath)) {
    const raw = fs.readFileSync(contractArtifactPath, "utf8");
    const parsed = JSON.parse(raw);
    contractAbi = parsed.abi || [];
    if (!contractAddress && parsed.address) {
      contractAddress = parsed.address;
    }
  } else {
    console.warn("contract.json not found yet; deploy first.");
  }
} catch (err) {
  console.warn("Failed to load contract.json", err.message);
}

const provider = new ethers.JsonRpcProvider(GANACHE_RPC_URL);
const signer = SIGNER_PRIVATE_KEY ? new ethers.Wallet(SIGNER_PRIVATE_KEY, provider) : null;
const contractRead = contractAddress && contractAbi.length
  ? new ethers.Contract(contractAddress, contractAbi, provider)
  : null;
const contractWrite = contractRead && signer ? contractRead.connect(signer) : null;

const app = express();
app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
app.use(express.json({ limit: "50mb" }));

app.use(express.urlencoded({ limit: "50mb", extended: true }));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB cap to avoid upstream 413
});

// Convert ethers.js BigInt/BigNumber to plain JSON-safe values
function normalize(value) {
  if (typeof value === "bigint") return value.toString();
  if (value && typeof value === "object") {
    if (Array.isArray(value)) return value.map(normalize);
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = normalize(v);
    }
    return out;
  }
  return value;
}

app.get("/", (_req, res) => {
  res.send("BlockIDChain Backend is running successfully!");
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Lightweight Pinata diagnostics endpoint to help debug credentials
app.get("/pinata/health", async (_req, res) => {
  const { PINATA_API_KEY, PINATA_API_SECRET } = process.env;
  if (!PINATA_API_KEY || !PINATA_API_SECRET) {
    return res.status(500).json({
      ok: false,
      error: "Pinata credentials missing (PINATA_API_KEY / PINATA_API_SECRET)",
    });
  }

  try {
    const checkAuth = await axios.get("https://api.pinata.cloud/data/testAuthentication", {
      headers: {
        pinata_api_key: PINATA_API_KEY,
        pinata_secret_api_key: PINATA_API_SECRET,
      }
    });

    res.json({
      ok: true,
      message: checkAuth.data.message
    });
  } catch (err) {
    const detail = err?.response?.data || err?.message || String(err);
    console.error("Pinata health error", detail);
    res.status(502).json({ ok: false, error: "Pinata API error", detail });
  }
});

app.post("/ipfs/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file is required" });
  if (!process.env.PINATA_API_KEY || !process.env.PINATA_API_SECRET) {
    return res.status(500).json({ error: "Pinata credentials missing" });
  }

  try {
    const { cid, raw } = await uploadToPinata(req.file.buffer, req.file.originalname, req.file.mimetype);
    if (!cid) {
      console.error("Pinata upload returned no cid", raw);
      return res.status(502).json({ error: "Upload returned no CID", detail: raw });
    }
    res.json({ cid, raw });
  } catch (err) {
    const detail = err?.response?.data || err?.message || err?.toString();
    console.error("Pinata upload error", detail, err?.stack);
    res.status(502).json({ error: "Upload failed", detail });
  }
});

app.post("/cert/register", async (req, res) => {
  const { subjectId, publicKey, documentHash, ipfsCid, signatureHex } = req.body;

  if (!contractWrite) {
    console.error("registerCertificate aborted: contractWrite missing", {
      hasSigner: !!signer,
      contractAddress,
      abiLoaded: !!contractAbi.length,
    });
    return res.status(500).json({ error: "Contract not initialized with signer. Deploy and configure env." });
  }
  if (!subjectId || !publicKey || !documentHash || !ipfsCid || !signatureHex) {
    console.warn("registerCertificate missing fields", { subjectId, hasPublicKey: !!publicKey, hasDocHash: !!documentHash, hasCid: !!ipfsCid, hasSig: !!signatureHex });
    return res.status(400).json({ error: "Missing fields" });
  }
  if (!ethers.isHexString(documentHash, 32)) {
    return res.status(400).json({ error: "documentHash must be 0x-prefixed 32-byte hex" });
  }
  if (!ethers.isHexString(signatureHex)) {
    return res.status(400).json({ error: "signatureHex must be hex string" });
  }

  try {
    console.info("registerCertificate request", { subjectId, ipfsCid, documentHash, publicKeyLen: publicKey.length, signatureLen: signatureHex.length });
    const tx = await contractWrite.registerCertificate(
      subjectId,
      publicKey,
      documentHash,
      ipfsCid,
      ethers.getBytes(signatureHex)
    );
    const receipt = await tx.wait();
    const event = receipt.events?.find((e) => e.event === "CertificateRegistered");
    const eventCertId = event?.args?.certId ?? event?.args?.[0] ?? null;
    const derivedCertId = await contractRead.getCertificateId(subjectId, publicKey, documentHash);
    const certId = eventCertId || derivedCertId;
    res.json({ txHash: receipt.transactionHash, certId, blockNumber: receipt.blockNumber, event: event?.args });
  } catch (err) {
    const reason = err?.reason || err?.message || err?.toString();
    const code = err?.code;
    const dataMessage = err?.data?.message;
    console.error("registerCertificate error", { reason, code, dataMessage, err });
    res.status(500).json({ error: "Contract call failed", detail: reason, code, dataMessage });
  }
});

app.get("/cert/:certId", async (req, res) => {
  if (!contractRead) return res.status(500).json({ error: "Contract not initialized. Deploy and configure env." });
  try {
    const cert = await contractRead.getCertificate(req.params.certId);
    const mapped = {
      subjectId: cert.subjectId ?? cert[0],
      issuer: cert.issuer ?? cert[1],
      publicKey: cert.publicKey ?? cert[2],
      documentHash: cert.documentHash ?? cert[3],
      ipfsCid: cert.ipfsCid ?? cert[4],
      signature: cert.signature ? ethers.hexlify(cert.signature) : cert[5] ? ethers.hexlify(cert[5]) : undefined,
      issuedAt: cert.issuedAt?.toString?.() ?? cert[6]?.toString?.(),
    };
    res.json({ cert: mapped });
  } catch (err) {
    console.error("getCertificate error", err);
    res.status(404).json({ error: "Certificate not found", detail: err.reason || err.message });
  }
});

app.post("/cert/compute-id", async (req, res) => {
  const { subjectId, publicKey, documentHash } = req.body;
  if (!contractRead) return res.status(500).json({ error: "Contract not initialized. Deploy and configure env." });
  if (!ethers.isHexString(documentHash, 32)) {
    return res.status(400).json({ error: "documentHash must be 0x-prefixed 32-byte hex" });
  }
  try {
    const certId = await contractRead.getCertificateId(subjectId, publicKey, documentHash);
    res.json({ certId });
  } catch (err) {
    res.status(500).json({ error: "compute-id failed", detail: err.reason || err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend listening on :${PORT}`);
});
