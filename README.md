# BlockIDChain

Implementing Distributed PKI for the web backed by Ethereum. BlockIDChain replaces centralized certificate authorities with a smart contract that anchors public keys and document fingerprints, while documents stay on IPFS.

## Concept
- Self-sovereign identity: issuers generate RSA keys in-browser; private keys never leave the client.
- Tamper-proof: document hash + public key + signature are recorded on-chain; edits break verification.
- Privacy: documents are stored off-chain on IPFS (Apillon); only hashes and metadata are public.

## How it works
### Phase 1: Registration (Issue)
1) Issuer uploads a document in the React app.
2) Browser generates an RSA key pair, hashes the file with SHA-256, and signs the hash with the private key.
3) File is uploaded to IPFS via Apillon, returning a CID.
4) Backend registers on-chain: public key, document hash, signature, CID, and subject ID. Transaction is final on the blockchain.

### Phase 2: Verification (Check)
1) Verifier enters a certificate ID in the React portal.
2) Backend reads the on-chain record to get the stored hash, public key, signature, and CID.
3) App fetches the file from IPFS by CID, re-hashes it, and verifies the signature with the stored public key.
4) If hash and signature both match, the certificate is authentic; otherwise it is flagged as tampered.

## Stack
- Blockchain: Solidity + Hardhat (Ganache local network), ethers.js.
- Storage: IPFS via Apillon (CID-based content addressing).
- Frontend: React (Vite), client-side WebCrypto (RSA + SHA-256) for keygen/signing.
- Backend: Node/Express for IPFS upload proxy and contract calls.
- Database: not used in this build (MongoDB suggested in the guide but intentionally omitted).

## Prerequisites
- Ganache running locally (HTTP RPC URL).
- Apillon IPFS bucket (bucket ID, API key, API secret).
- Node 18+.

## Quick start
1) Install deps: `npm install` (workspaces).  
2) Configure envs: copy `.env.example` under `contract/`, `backend/`, `frontend/` and fill RPC + Apillon creds.  
3) Compile/test contracts: `npm run contract:test`.  
4) Deploy to Ganache: `npm run contract:deploy` (writes ABI/address to backend/frontend).  
5) Start backend: `npm run backend:dev`.  
6) Start frontend: `npm run frontend:dev`.

## Environment
- `contract/.env`: `GANACHE_RPC_URL`, `DEPLOYER_PRIVATE_KEY`.  
- `backend/.env`: `GANACHE_RPC_URL`, `SIGNER_PRIVATE_KEY`, `CONTRACT_ADDRESS` (or use generated `backend/src/contract.json`), `APILLON_API_KEY`, `APILLON_API_SECRET`, `APILLON_BUCKET_ID`, `APILLON_API_BASE`, `PORT`, `FRONTEND_ORIGIN`.  
- `frontend/.env`: `VITE_BACKEND_URL`, `VITE_CONTRACT_ADDRESS` (optional), `VITE_GANACHE_RPC_URL`.

## Flows
### Issue
1) User enters subject ID and picks a file.  
2) Browser generates RSA keys (2048-bit), downloads the private key PEM to the user, hashes the file (SHA-256), signs the hash, uploads to IPFS (Apillon), then registers on-chain with hash/public key/signature/CID.  
3) UI shows cert ID, tx hash, hash, and CID.

### Verify
1) User pastes cert ID.  
2) App fetches the on-chain record, downloads the file from IPFS, re-hashes, and verifies the signature with the stored public key.  
3) UI shows hash match, signature validity, issuer, and timestamp.
