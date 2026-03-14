import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { ethers } from "ethers";
import contractInfo from "./contract.json";

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

function StepList({ steps }) {
  return (
    <div className="steps">
      {steps.map((s) => (
        <div key={s.label} className={`step ${s.state}`}>
          <span className="dot" />
          <div>
            <div className="step-label">{s.label}</div>
            <div className="step-state">{s.state}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [chainId, setChainId] = useState("");
  const [walletStatus, setWalletStatus] = useState("Not connected");

  useEffect(() => {
    if (!window.ethereum) {
      setWalletStatus("MetaMask not found");
      return;
    }
    const handleAccounts = (accs) => {
      setAccounts(accs);
      setSelectedAccount((prev) => (accs.includes(prev) ? prev : accs[0] || ""));
      setWalletStatus(accs.length ? "Connected" : "Not connected");
    };
    const handleChain = (id) => setChainId(id);

    window.ethereum.request({ method: "eth_accounts" }).then(handleAccounts).catch(() => {});
    window.ethereum.request({ method: "eth_chainId" }).then(handleChain).catch(() => {});
    window.ethereum.on("accountsChanged", handleAccounts);
    window.ethereum.on("chainChanged", handleChain);
    return () => {
      window.ethereum?.removeListener("accountsChanged", handleAccounts);
      window.ethereum?.removeListener("chainChanged", handleChain);
    };
  }, []);

  const provider = useMemo(() => {
    if (!window.ethereum) return null;
    return new ethers.BrowserProvider(window.ethereum);
  }, [chainId]);

  const connectWallet = async () => {
    if (!window.ethereum) {
      setWalletStatus("MetaMask not found");
      return;
    }
    try {
      const accs = await window.ethereum.request({ method: "eth_requestAccounts" });
      setAccounts(accs);
      setSelectedAccount(accs[0] || "");
      const id = await window.ethereum.request({ method: "eth_chainId" });
      setChainId(id);
      setWalletStatus("Connected");
    } catch (err) {
      console.error(err);
      setWalletStatus("Connection rejected");
    }
  };

  return (
    <div className="page">
      <header>
        <div>
          <p className="eyebrow">Decentralized PKI</p>
          <h1>BlockIDChain</h1>
          <p>Issue and verify documents with Ganache + Pinata IPFS. Keys stay in your browser.</p>
        </div>
        <div className="pill">RSA · SHA-256 · IPFS · Ethereum</div>
      </header>
      <div className="wallet-bar card">
        <div>
          <div className="eyebrow">Wallet</div>
          <div className="wallet-row">
            <button type="button" onClick={connectWallet}>Connect MetaMask</button>
            <select
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value)}
              disabled={!accounts.length}
            >
              <option value="">Select account</option>
              {accounts.map((acct) => (
                <option key={acct} value={acct}>{acct}</option>
              ))}
            </select>
          </div>
          <div className="status-line">{walletStatus}{chainId ? ` · chain ${parseInt(chainId, 16)}` : ""}</div>
        </div>
      </div>
      <div className="grid">
        <IssueForm
          provider={provider}
          selectedAccount={selectedAccount}
          accounts={accounts}
          connectWallet={connectWallet}
        />
        <VerifyForm
          provider={provider}
          selectedAccount={selectedAccount}
          accounts={accounts}
          connectWallet={connectWallet}
        />
      </div>
    </div>
  );
}

function IssueForm({ provider, selectedAccount, accounts, connectWallet }) {
  const [subjectId, setSubjectId] = useState("");
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("");
  const [steps, setSteps] = useState([]);
  const [result, setResult] = useState(null);

  const pushStep = (label, state = "pending") => {
    setSteps((prev) => {
      const existing = prev.filter((s) => s.label !== label);
      return [...existing, { label, state }];
    });
  };

  const setStepState = (label, state) => {
    setSteps((prev) => prev.map((s) => (s.label === label ? { ...s, state } : s)));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setResult(null);
    setSteps([]);

    if (!provider || !selectedAccount) {
      setStatus("Connect MetaMask and pick an account");
      return;
    }

    if (!file) {
      setStatus("Choose a file first");
      return;
    }
    pushStep("Generate RSA keys", "active");
    setStatus("Generating RSA keys...");

    try {
      const { publicKey, privateKey, publicKeyPem, privateKeyPem } = await generateRsaKeyPair();
      setStepState("Generate RSA keys", "done");
      downloadTextFile(`private-key-${Date.now()}.pem`, privateKeyPem);

      pushStep("Hash document", "active");
      setStatus("Hashing document...");
      const fileBuffer = await file.arrayBuffer();
      const hashBuffer = await hashArrayBuffer(fileBuffer);
      const documentHashHex = hexFromBuffer(hashBuffer);
      setStepState("Hash document", "done");

      pushStep("Sign hash", "active");
      setStatus("Signing hash with your RSA key...");
      const signatureBuffer = await window.crypto.subtle.sign(
        { name: "RSASSA-PKCS1-v1_5" },
        privateKey,
        hashBuffer
      );
      const signatureHex = hexFromBuffer(signatureBuffer);
      setStepState("Sign hash", "done");

      pushStep("Upload to IPFS", "active");
      setStatus("Uploading to IPFS via Pinata...");
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
      setStepState("Upload to IPFS", "done");

      pushStep("Register on-chain", "active");
      setStatus("Registering on-chain via MetaMask...");

      const signer = await provider.getSigner(selectedAccount);
      const contract = new ethers.Contract(contractInfo.address, contractInfo.abi, signer);
      const predictedCertId = await contract.getCertificateId(subjectId, publicKeyPem, documentHashHex);
      const tx = await contract.registerCertificate(subjectId, publicKeyPem, documentHashHex, cid, signatureHex);
      const receipt = await tx.wait();
      const txHash = receipt?.hash;

      setResult({ certId: predictedCertId, txHash, cid, documentHashHex, publicKeyPem, issuer: selectedAccount });
      setStepState("Register on-chain", "done");
      setStatus("Done. Private key downloaded—keep it safe.");
    } catch (err) {
      console.error(err);
      const detail = err.response?.data?.error || err.message;
      setStatus(`Error: ${detail}`);
      setStepState("Register on-chain", "error");
    }
  };

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <p className="eyebrow">Issuer</p>
          <h2>Issue Certificate</h2>
        </div>
        <div className="badge">On-chain + IPFS</div>
      </div>
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
      <div className="status-line">{status}</div>
      <StepList steps={steps} />
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
    </section>
  );
}

function VerifyForm({ provider, selectedAccount, accounts, connectWallet }) {
  const [certId, setCertId] = useState("");
  const [status, setStatus] = useState("");
  const [steps, setSteps] = useState([]);
  const [result, setResult] = useState(null);
  const [verifyError, setVerifyError] = useState("");
  const [verifyResult, setVerifyResult] = useState(null);
  const [verifySteps, setVerifySteps] = useState([]);

  const pushStep = (label, state = "pending") => {
    setSteps((prev) => {
      const existing = prev.filter((s) => s.label !== label);
      return [...existing, { label, state }];
    });
  };

  const setStepState = (label, state) => {
    setSteps((prev) => prev.map((s) => (s.label === label ? { ...s, state } : s)));
  };

  const handleVerify = async () => {
    setVerifyError('');
    setVerifyResult(null);
    const steps = [];
    const addStep = (label, status = 'pending', detail = '') => {
      steps.push({ label, status, detail });
      setVerifySteps([...steps]);
    };

    if (!certId) {
      setVerifyError('Please provide a certificate ID.');
      return;
    }

    addStep('Fetch on-chain record');
    try {
      // open verification: no issuer-account restriction
      const res = await axios.get(`${backendBase}/cert/${certId}`);
      const cert = res.data?.cert;
      if (!cert) throw new Error('Certificate not found');

      addStep('Download file from IPFS');
      const fileRes = await fetch(ipfsGateway(cert.ipfsCid));
      if (!fileRes.ok) throw new Error(`IPFS fetch failed: ${fileRes.status}`);
      const fileBuf = await fileRes.arrayBuffer();

      addStep('Re-hash document');
      const hashHex = await hashFile(new Blob([fileBuf]));
      const hashMatch = hashHex === cert.documentHash;

      addStep('Verify signature');
      const sigOk = await verifySignature(cert.publicKey, hexToBytes(cert.documentHash), cert.signature);

      addStep('Done', 'done');
      setVerifyResult({
        ...cert,
        recomputedHash: hashHex,
        hashMatch,
        signatureValid: sigOk,
      });
    } catch (err) {
      addStep('Error', 'error', err.message || 'Verify failed');
      setVerifyError(err.message || 'Verify failed');
    }
  };

  const handleVerifyLegacy = async (e) => {
    e.preventDefault();
    setResult(null);
    setSteps([]);

    if (!provider || !selectedAccount) {
      setStatus("Connect MetaMask and pick an account");
      return;
    }
    pushStep("Fetch certificate", "active");
    setStatus("Fetching certificate...");

    try {
      const certRes = await axios.get(`${backendBase}/cert/${certId}`);
      const cert = certRes.data.cert;
      const issuerMatch = cert.issuer?.toLowerCase() === selectedAccount.toLowerCase();
      // if (!issuerMatch) {
      //   setStatus("Selected account is not the issuer of this certificate.");
      //   setStepState("Fetch certificate", "error");
      //   return;
      // }
      setStepState("Fetch certificate", "done");

      pushStep("Download from IPFS", "active");
      setStatus("Downloading file from IPFS...");
      const fileRes = await fetch(`${ipfsGateway}/${cert.ipfsCid}`);
      const fileBuffer = await fileRes.arrayBuffer();
      setStepState("Download from IPFS", "done");

      pushStep("Hash file", "active");
      setStatus("Hashing file...");
      const hashBuffer = await hashArrayBuffer(fileBuffer);
      const computedHashHex = hexFromBuffer(hashBuffer);
      const hashMatches = computedHashHex.toLowerCase() === cert.documentHash.toLowerCase();
      setStepState("Hash file", "done");

      pushStep("Verify signature", "active");
      setStatus("Verifying signature...");
      const publicKey = await importPublicKeyFromPem(cert.publicKey);
      const signatureBuffer = bufferFromHex(cert.signature);
      const signatureValid = await window.crypto.subtle.verify(
        { name: "RSASSA-PKCS1-v1_5" },
        publicKey,
        signatureBuffer,
        hashBuffer
      );
      setStepState("Verify signature", "done");

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
      setStepState("Verify signature", "error");
    }
  };

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <p className="eyebrow">Verifier</p>
          <h2>Verify Certificate</h2>
        </div>
        <div className="badge muted">Trustless check</div>
      </div>
      <form onSubmit={handleVerifyLegacy} className="form">
        <label>
          Cert ID (0x...)
          <input value={certId} onChange={(e) => setCertId(e.target.value)} placeholder="0x..." required />
        </label>
        <button type="submit">Verify</button>
      </form>
      <div className="status-line">{status}</div>
      <StepList steps={steps} />
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
      {verifyResult && (
        <div className="panel success">
          <div className="panel-title">Verification Result</div>
          <div className="kv"><span>Issuer</span><span>{verifyResult.issuer || '—'}</span></div>
          <div className="kv"><span>IPFS CID</span><span>{verifyResult.ipfsCid}</span></div>
          <div className="kv"><span>On-chain Hash</span><code>{verifyResult.documentHash}</code></div>
          <div className="kv"><span>Recomputed Hash</span><code>{verifyResult.recomputedHash}</code></div>
          <div className="kv"><span>Hash Match</span><span className={verifyResult.hashMatch ? 'pill pill-ok' : 'pill pill-bad'}>{verifyResult.hashMatch ? 'Yes' : 'No'}</span></div>
          <div className="kv"><span>Signature Valid</span><span className={verifyResult.signatureValid ? 'pill pill-ok' : 'pill pill-bad'}>{verifyResult.signatureValid ? 'Yes' : 'No'}</span></div>
          <div className="kv"><span>Public Key</span><code className="multiline">{verifyResult.publicKey}</code></div>
          <div className="kv"><span>Issued At</span><span>{verifyResult.issuedAt ? new Date(Number(verifyResult.issuedAt) * 1000).toISOString() : '—'}</span></div>
        </div>
      )}
      {verifyError && <div className="error">{verifyError}</div>}
    </section>
  );
}
