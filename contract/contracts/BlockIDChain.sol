// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title BlockIDChain - store certificate fingerprints on-chain
/// @notice Records document hash, issuer, public key, IPFS CID, and signature for off-chain verification.
contract BlockIDChain {
    struct Certificate {
        string subjectId;        // external identifier (e.g., student ID)
        address issuer;          // account that registered the certificate
        string publicKey;        // RSA public key (PEM or base64)
        bytes32 documentHash;    // SHA-256 hash of the document
        string ipfsCid;          // IPFS CID pointing to the original document
        bytes signature;         // signature over the document hash (stored for off-chain verification)
        uint256 issuedAt;        // block timestamp when issued
    }

    mapping(bytes32 => Certificate) private certificates;

    event CertificateRegistered(bytes32 indexed certId, string subjectId, address indexed issuer, string ipfsCid);

    /// @notice Register a certificate fingerprint on-chain.
    /// @param subjectId external identifier used by the issuer (student ID, employee ID, etc.)
    /// @param publicKey RSA public key as string (PEM or base64-encoded)
    /// @param documentHash SHA-256 hash of the document content
    /// @param ipfsCid IPFS CID returned after uploading the document
    /// @param signature signature generated off-chain over the document hash
    /// @return certId deterministic ID derived from subjectId, publicKey, and documentHash
    function registerCertificate(
        string calldata subjectId,
        string calldata publicKey,
        bytes32 documentHash,
        string calldata ipfsCid,
        bytes calldata signature
    ) external returns (bytes32 certId) {
        certId = keccak256(abi.encodePacked(subjectId, publicKey, documentHash));
        require(certificates[certId].issuer == address(0), "Certificate exists");

        certificates[certId] = Certificate({
            subjectId: subjectId,
            issuer: msg.sender,
            publicKey: publicKey,
            documentHash: documentHash,
            ipfsCid: ipfsCid,
            signature: signature,
            issuedAt: block.timestamp
        });

        emit CertificateRegistered(certId, subjectId, msg.sender, ipfsCid);
        return certId;
    }

    /// @notice Retrieve full certificate metadata.
    function getCertificate(bytes32 certId) external view returns (Certificate memory) {
        Certificate memory cert = certificates[certId];
        require(cert.issuer != address(0), "Not found");
        return cert;
    }

    /// @notice Check if a certificate exists for the given id.
    function certificateExists(bytes32 certId) external view returns (bool) {
        return certificates[certId].issuer != address(0);
    }

    /// @notice Deterministically compute the certificate id (off-chain parity helper).
    function getCertificateId(
        string calldata subjectId,
        string calldata publicKey,
        bytes32 documentHash
    ) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(subjectId, publicKey, documentHash));
    }

    /// @notice Verify if the provided document hash matches the stored one.
    function isDocumentHashMatch(bytes32 certId, bytes32 documentHash) external view returns (bool) {
        Certificate storage cert = certificates[certId];
        require(cert.issuer != address(0), "Not found");
        return cert.documentHash == documentHash;
    }
}
