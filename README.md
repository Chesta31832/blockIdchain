# BlockIDChain

Decentralized PKI and certificate verification using Ethereum (Ganache), IPFS (Apillon), and a React/Node stack. Certificates are hashed (SHA-256), signed client-side with RSA, stored off-chain on IPFS, and registered on-chain with their hash, public key, and signature.

## Stack
- Solidity + Hardhat (Ganache)
- Node/Express backend (IPFS upload proxy via Apillon, contract calls via ethers)
- React frontend (client-side RSA keygen, hashing/signing, issue + verify flows)

## Prerequisites
- Ganache running locally (HTTP RPC URL)
- Apillon IPFS bucket (bucket ID, API key, API secret)
- Node 18+

## Quick Start
1) Install deps: `npm install` (uses workspaces).  
2) Configure envs: copy `.env.example` files under `contract/`, `backend/`, `frontend/` and fill in RPC URL + Apillon creds.  
3) Compile/test contracts: `npm run contract:test`.  
4) Deploy contract to Ganache: `npm run contract:deploy` (writes address/ABI to backend/frontend).  
5) Start backend: `npm run backend:dev`.  
6) Start frontend: `npm run frontend:dev`.

## Notes
- Private keys are generated and kept in-browser; the private key auto-downloads as a file during issuance.
- Only document fingerprints (hashes) and metadata live on-chain; documents reside on IPFS via Apillon.

## Environment
- `contract/.env`: `GANACHE_RPC_URL`, `DEPLOYER_PRIVATE_KEY` (Ganache account used to deploy).  
- `backend/.env`: `GANACHE_RPC_URL`, `SIGNER_PRIVATE_KEY` (account used to call register), `CONTRACT_ADDRESS` (or rely on generated `backend/src/contract.json` after deploy), `APILLON_API_KEY`, `APILLON_API_SECRET`, `APILLON_BUCKET_ID`, `APILLON_API_BASE`, `PORT`, `FRONTEND_ORIGIN`.  
- `frontend/.env`: `VITE_BACKEND_URL`, `VITE_CONTRACT_ADDRESS` (optional informational), `VITE_GANACHE_RPC_URL`.

## Flows
### Issue
1) User selects a document and enters a subject ID.  
2) Browser generates RSA keys (2048-bit), downloads the private key PEM automatically, hashes the document (SHA-256), signs the hash, uploads the document to IPFS via Apillon, then registers the cert on-chain with hash/public key/signature/CID.  
3) UI returns the cert ID, tx hash, hash, CID.

### Verify
1) User pastes cert ID.  
2) App fetches on-chain record via backend, downloads the file from IPFS, re-hashes, and verifies the stored signature using the stored public key.  
3) UI shows hash match + signature validity + issuer/timestamp.
