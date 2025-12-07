import React, { useState } from "react";
import axios from "axios";

const backendBase = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";
const ipfsGateway = "https://ipfs.io/ipfs";

async function generateRsaKeyPair() {
  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"]
  );

  const spki = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);
  const pkcs8 = await window.crypto.subtle.exportKey("pkcs8", keyPair.privateKey);

  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    publicKeyPem: toPem(spki, "PUBLIC KEY"),
    privateKeyPem: toPem(pkcs8, "PRIVATE KEY"),
  };
}

function toPem(buffer, label) {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
  const wrapped = base64.match(/.{1,64}/g).join("\n");
  return `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----`;
}

function hexFromBuffer(buffer) {
  return `0x${[...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function bufferFromHex(hex) {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.match(/.{1,2}/g).map((x) => parseInt(x, 16)));
  return bytes.buffer;
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function hashArrayBuffer(buffer) {
  const digest = await window.crypto.subtle.digest("SHA-256", buffer);
  return digest;
}

async function importPublicKeyFromPem(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const binary = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return window.crypto.subtle.importKey(
    "spki",
    binary,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    true,
    ["verify"]
  );
}

function Section({ title, children }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export default function App() {
  return (
    <div className="page">
      <header>
        <h1>BlockIDChain</h1>
        <p>Issue and verify documents with blockchain + IPFS. RSA keys stay in your browser.</p>
      </header>
      <div className="grid">
        <IssueForm />
        <VerifyForm />
      </div>
    </div>
  );
}

function IssueForm() {
  const [subjectId, setSubjectId] = useState("");
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setResult(null);

    if (!file) {
      setStatus("Choose a file first");
      return;
    }
    setStatus("Generating RSA keys...");

    try {
      const { publicKey, privateKey, publicKeyPem, privateKeyPem } = await generateRsaKeyPair();
      downloadTextFile(`private-key-${Date.now()}.pem`, privateKeyPem);

      setStatus("Hashing document...");
      const fileBuffer = await file.arrayBuffer();
      const hashBuffer = await hashArrayBuffer(fileBuffer);
      const documentHashHex = hexFromBuffer(hashBuffer);

      setStatus("Signing hash with your RSA key...");
      const signatureBuffer = await window.crypto.subtle.sign(
        { name: "RSASSA-PKCS1-v1_5" },
        privateKey,
        hashBuffer
      );
      const signatureHex = hexFromBuffer(signatureBuffer);

      setStatus("Uploading to IPFS via Apillon...");
      const formData = new FormData();
      formData.append("file", file, file.name);
      const uploadRes = await axios.post(`${backendBase}/ipfs/upload`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const cid =
        uploadRes.data.cid ||
        uploadRes.data.raw?.cid ||
        uploadRes.data.raw?.data?.cid ||
        uploadRes.data.raw?.data?.[0]?.cid ||
        uploadRes.data.raw?.files?.[0]?.cid ||
        uploadRes.data.raw?.CID;
      if (!cid) {
        console.error("Upload response missing CID", uploadRes.data);
        throw new Error("Upload did not return CID");
      }

      setStatus("Registering on-chain...");
      const registerRes = await axios.post(`${backendBase}/cert/register`, {
        subjectId,
        publicKey: publicKeyPem,
        documentHash: documentHashHex,
        ipfsCid: cid,
        signatureHex,
      });

      const certId =
        registerRes.data.certId ||
        registerRes.data?.event?.certId ||
        registerRes.data?.event?.[0] ||
        registerRes.data?.data?.certId ||
        "(check contract)";
      setResult({ certId, txHash: registerRes.data.txHash, cid, documentHashHex, publicKeyPem });
      setStatus("Done. Private key downloaded—keep it safe.");
    } catch (err) {
      console.error(err);
      const detail = err.response?.data?.error || err.message;
      setStatus(`Error: ${detail}`);
    }
  };

  return (
    <Section title="Issue Certificate">
      <form onSubmit={handleSubmit} className="form">
        <label>
          Subject ID
          <input value={subjectId} onChange={(e) => setSubjectId(e.target.value)} placeholder="e.g. student123" required />
        </label>
        <label>
          Document file
          <input type="file" onChange={(e) => setFile(e.target.files[0])} required />
        </label>
        <button type="submit">Issue</button>
      </form>
      <p className="status">{status}</p>
      {result && (
        <div className="result">
          <p><strong>Cert ID:</strong> {result.certId}</p>
          <p><strong>Tx Hash:</strong> {result.txHash}</p>
          <p><strong>IPFS CID:</strong> {result.cid}</p>
          <p><strong>Document Hash:</strong> {result.documentHashHex}</p>
          <details>
            <summary>Public Key</summary>
            <pre>{result.publicKeyPem}</pre>
          </details>
        </div>
      )}
    </Section>
  );
}

function VerifyForm() {
  const [certId, setCertId] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState(null);

  const handleVerify = async (e) => {
    e.preventDefault();
    setResult(null);
    setStatus("Fetching certificate...");

    try {
      const certRes = await axios.get(`${backendBase}/cert/${certId}`);
      const cert = certRes.data.cert;

      setStatus("Downloading file from IPFS...");
      const fileRes = await fetch(`${ipfsGateway}/${cert.ipfsCid}`);
      const fileBuffer = await fileRes.arrayBuffer();

      setStatus("Hashing file...");
      const hashBuffer = await hashArrayBuffer(fileBuffer);
      const computedHashHex = hexFromBuffer(hashBuffer);
      const hashMatches = computedHashHex.toLowerCase() === cert.documentHash.toLowerCase();

      setStatus("Verifying signature...");
      const publicKey = await importPublicKeyFromPem(cert.publicKey);
      const signatureBuffer = bufferFromHex(cert.signature);
      const signatureValid = await window.crypto.subtle.verify(
        { name: "RSASSA-PKCS1-v1_5" },
        publicKey,
        signatureBuffer,
        hashBuffer
      );

      setResult({
        ipfsCid: cert.ipfsCid,
        documentHash: cert.documentHash,
        computedHashHex,
        hashMatches,
        signatureValid,
        issuer: cert.issuer,
        issuedAt: Number(cert.issuedAt) * 1000,
      });
      setStatus("Verification complete.");
    } catch (err) {
      console.error(err);
      const detail = err.response?.data?.error || err.message;
      setStatus(`Error: ${detail}`);
    }
  };

  return (
    <Section title="Verify Certificate">
      <form onSubmit={handleVerify} className="form">
        <label>
          Cert ID (0x...)
          <input value={certId} onChange={(e) => setCertId(e.target.value)} placeholder="0x..." required />
        </label>
        <button type="submit">Verify</button>
      </form>
      <p className="status">{status}</p>
      {result && (
        <div className="result">
          <p><strong>IPFS CID:</strong> {result.ipfsCid}</p>
          <p><strong>On-chain hash:</strong> {result.documentHash}</p>
          <p><strong>Recomputed hash:</strong> {result.computedHashHex}</p>
          <p><strong>Hash matches:</strong> {result.hashMatches ? "Yes" : "No"}</p>
          <p><strong>Signature valid:</strong> {result.signatureValid ? "Yes" : "No"}</p>
          <p><strong>Issuer:</strong> {result.issuer}</p>
          <p><strong>Issued at:</strong> {new Date(result.issuedAt).toLocaleString()}</p>
        </div>
      )}
    </Section>
  );
}
