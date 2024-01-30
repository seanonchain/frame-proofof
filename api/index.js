import { getStore } from "@netlify/blobs";
import { URLSearchParams } from 'url';
import { getSSLHubRpcClient, Message } from "@farcaster/hub-nodejs";
import { EAS, SchemaEncoder } from "@ethereum-attestation-service/eas-sdk";
import { ethers } from "ethers";
import sdk from 'api'('@neynar/v2.0#r1pf443blrx2cym4');

const HUB_URL = process.env['HUB_URL'] || "nemes.farcaster.xyz:2283";
const client = getSSLHubRpcClient(HUB_URL);

const requiredEnvVars = ['HUB_URL', 'NEYNAR_API_KEY', 'ALCHEMY_KEY', 'PRIVATE_KEY', 'SYNDICATE_API_KEY'];
requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    throw new Error(`Missing required environment variable: ${varName}`);
  }
});
const EAS_CONTRACT_ADDRESS = "0x4200000000000000000000000000000000000021";
const SCHEMA_UID = "0x9008c7f681e3035347c65d01a7bb3383a85e9d121f5a797e59077cfea964b87c";

async function validateFrameMessage(req) {
  const frameMessage = Message.decode(Buffer.from(req.body?.trustedData?.messageBytes || '', 'hex'));
  return await client.validateMessage(frameMessage);
}

async function getUserData(validatedMessage) {
    const fid = validatedMessage.data.fid;
    try {
      const response = await sdk.user({fid: fid, viewerFid: fid, api_key: process.env['NEYNAR_API_KEY']});
      return response.data;
    } catch (err) {
      console.error(err);
      return undefined;
    }
  }
  
  function getAttestWallet(userData) {
    if (userData) {
      return userData.result.user.verifications[0] ?? userData.result.user.custodyAddress;
    } else {
      console.error('userData is undefined');
      return undefined;
    }
  }

async function getFollowersCount(fid) {
try {
    const response = await sdk.user({fid: fid, viewerFid: fid, api_key: process.env['NEYNAR_API_KEY']});
    return response.data.result.user.followerCount;
} catch (err) {
    console.error(err);
}
}

  async function submitAttestation(attestWallet, validatedMessage) {
    const fid = validatedMessage.data.fid;
    const cast_hash = validatedMessage.data.frameActionBody.castId.hash.toString('hex');
  
    const provider = ethers.getDefaultProvider(
      "base", {
        alchemy: process.env['ALCHEMY_KEY']
      }
    );
  
    const signer = new ethers.Wallet(process.env['PRIVATE_KEY'], provider);
  
    const eas = new EAS(EAS_CONTRACT_ADDRESS);  //https://docs.attest.sh/docs/quick--start/contracts#base
    eas.connect(signer);
  
    // Initialize SchemaEncoder with the schema string
    const schemaEncoder = new SchemaEncoder("bytes cast_hash, uint112 fid");
    const encodedData = schemaEncoder.encodeData([
      { name: "cast_hash", value: Buffer.from(cast_hash, 'hex'), type: "bytes" },
      { name: "fid", value: fid, type: "uint112" }
    ]);
  
    const tx = await eas.attest({
      schema: SCHEMA_UID,
      data: {
        recipient: attestWallet,
        expirationTime: 0,
        revocable: true, // Be aware that if your schema is not revocable, this MUST be false
        data: encodedData,
      },
    });
    const newAttestationUID = await tx.wait();
    console.log("New attestation UID:", newAttestationUID);
    return newAttestationUID;
}


export default async (req, context) => {
    const store = getStore('frameState');
    let rawCount = await store.get('count');
    let count = parseInt(rawCount);
    if (Number.isNaN(count)) count = 0;

    if (req.method === 'POST') {
        let data;
        if (req.headers['content-type'] === 'application/json') {
            // Parse JSON body
            data = JSON.parse(req.body);
        } else if (req.headers['content-type'] === 'application/x-www-form-urlencoded') {
            // Parse URL-encoded body
            data = Object.fromEntries(new URLSearchParams(req.body));
        }
        console.debug(data);
        const newCount = count+1;
        await store.set('count', newCount);
    }

    const host = process.env.URL;
    const imagePath = `${host}/og-image?count=${count}`;

    const html = `
        <!doctype html>
        <html>
        <head>
            <style>
                figure {
                    display: inline-block;
                    margin: 0;
                    max-width: 100%;
                }
                img {
                    max-width: 100%;
                    border: 4px inset black;
                }
            </style>
            <meta property="og:image" content="${imagePath}" />
            <meta property="fc:frame" content="vNext" />
            <meta property="fc:frame:image" content="${imagePath}" />
            <meta property="fc:frame:button:1" content="Frame me!" />
            <title>Simplest Frame</title>
        </head>
        <body>
            <h1>The Simplest Frame</h1>
            <figure>
                <img width="600" src="${imagePath}" />
            </figure>
            <!-- Form for POST request -->
            <form action="/" method="post">
                <input type="submit" value="Frame me!" /> ${count}
            </form>
        </body>
        </html>
    `
    
    try {
        const result = await validateFrameMessage(req);
        if (result.isOk() && result.value.valid) {
          const userData = await getUserData(result.value.message);
          const followerCount = userData.result.user.followerCount;
          const attestWallet = getAttestWallet(userData);
          const newAttestationUID = await submitAttestation(attestWallet, result.value.message);
      
          // Return a successful response
          return new Response(`New attestation UID: ${newAttestationUID}`, {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
          });
        } else {
          console.log(`Failed to validate message: ${result.error}`);
      
          // Return an error response
          return new Response(`Failed to validate message: ${result.error}`, {
            status: 400,
            headers: { 'Content-Type': 'text/plain' },
          });
        }
      } catch (error) {
        console.error(error);
      
        // Return an error response
        return new Response(`An error occurred: ${error.toString()}`, {
          status: 500,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
}

export const config = {
    path: "/"
};
