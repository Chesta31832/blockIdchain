const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BlockIDChain", () => {
  it("registers and retrieves a certificate", async () => {
    const [issuer] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("BlockIDChain");
    const contract = await Factory.deploy();
    await contract.deployed();

    const subjectId = "student-001";
    const publicKey = "PUBLICKEY";
    const documentHash = ethers.zeroPadValue("0x1234", 32);
    const ipfsCid = "cid123";
    const signature = "0xabcdef";

    const tx = await contract.registerCertificate(subjectId, publicKey, documentHash, ipfsCid, signature);
    const receipt = await tx.wait();
    const event = receipt.events.find((e) => e.event === "CertificateRegistered");
    const certId = event.args.certId;

    const stored = await contract.getCertificate(certId);
    expect(stored.subjectId).to.equal(subjectId);
    expect(stored.issuer).to.equal(issuer.address);
    expect(stored.publicKey).to.equal(publicKey);
    expect(stored.documentHash).to.equal(documentHash);
    expect(stored.ipfsCid).to.equal(ipfsCid);
    expect(stored.signature).to.equal(signature);
    expect(await contract.isDocumentHashMatch(certId, documentHash)).to.equal(true);
  });
});
