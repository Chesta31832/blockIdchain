import axios from "axios";
import FormData from "form-data";

export async function uploadToPinata(fileBuffer, fileName, contentType) {
  const { PINATA_API_KEY, PINATA_API_SECRET } = process.env;

  if (!PINATA_API_KEY || !PINATA_API_SECRET) {
    throw new Error("PINATA_API_KEY and PINATA_API_SECRET not set in .env");
  }

  const formData = new FormData();
  formData.append("file", fileBuffer, {
    filename: fileName,
    contentType: contentType,
  });

  const res = await axios.post("https://api.pinata.cloud/pinning/pinFileToIPFS", formData, {
    maxBodyLength: "Infinity",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${formData._boundary}`,
      pinata_api_key: PINATA_API_KEY,
      pinata_secret_api_key: PINATA_API_SECRET,
    },
  });

  if (!res.data.IpfsHash) {
    throw new Error("Pinata failed to return an IPFS hash (CID).");
  }

  return {
    cid: res.data.IpfsHash,
    raw: res.data,
  };
}
