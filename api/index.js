import { getStore } from "@netlify/blobs";
import { URLSearchParams } from 'url';
import { getSSLHubRpcClient, Message } from "@farcaster/hub-nodejs";
import { EAS, SchemaEncoder } from "@ethereum-attestation-service/eas-sdk";
import { ethers } from "ethers";
import sdk from 'api'('@neynar/v2.0#r1pf443blrx2cym4');
import { VercelRequest, VercelResponse } from "@vercel/node";
import { SyndicateClient } from "@syndicateio/syndicate-node";

const syndicate = new SyndicateClient({
  token: () => {
    const apiKey = process.env.SYNDICATE_API_KEY;
    if (typeof apiKey === "undefined") {
      // If you receive this error, you need to define the SYNDICATE_API_KEY in
      // your Vercel environment variables. You can find the API key in your
      // Syndicate project settings under the "API Keys" tab.
      throw new Error(
        "SYNDICATE_API_KEY is not defined in environment variables."
      );
    }
    return apiKey;
  },
});

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

export default async function (req: VercelRequest, res: VercelResponse) {
  // Farcaster Frames will send a POST request to this endpoint when the user
  // clicks the button. If we receive a POST request, we can assume that we're
  // responding to a Farcaster Frame button click.
  if (req.method == "POST") {
    try {
      console.log("req.body", req.body);
      // Mint the On-Chain Cow NFT. We're not passing in any arguments, since the
      // amount will always be 1
      const mintTx = await syndicate.transact.sendTransaction({
        projectId: "abcab73a-55d2-4441-a93e-edf95d183b34",
        contractAddress: "0xBeFD018F3864F5BBdE665D6dc553e012076A5d44",
        chainId: 84532,
        functionSignature: "mint(address to)",
        args: {
          // TODO: Change to the user's connected Farcaster address. This is going
          // to WillPapper.eth for now
          to: addressFromFid,
        },
      });
      console.log("Syndicate Transaction ID: ", mintTx.transactionId);

      res.status(200).setHeader("Content-Type", "text/html").send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width" />
          <meta property="og:title" content="On-Chain Cow!" />
          <meta
            property="og:image"
            content="https://on-chain-cow-farcaster-frame.vercel.app/img/on-chain-cow-happy-cow.png"
          />
          <meta property="fc:frame" content="vNext" />
          <meta
            property="fc:frame:image"
            content="https://on-chain-cow-farcaster-frame.vercel.app/img/on-chain-cow-happy-cow.png"
          />
          <meta
            property="fc:frame:button:1"
            content="Grow your on-chain pasture! Mint MORE COWS!"
          />
          <meta
            name="fc:frame:post_url"
            content="https://on-chain-cow-farcaster-frame.vercel.app/api/on-chain-cow-farcaster-frame"
          />
        </head>
      </html>
      `);
    } catch (error) {
      res.status(500).send(`Error: ${error.message}`);
    }
  } else {
    // If the request is not a POST, we know that we're not dealing with a
    // Farcaster Frame button click. Therefore, we should send the Farcaster Frame
    // content
    res.status(200).setHeader("Content-Type", "text/html").send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width" />
        <meta property="og:title" content="On-Chain Cow!" />
        <meta
          property="og:image"
          content="https://on-chain-cow-farcaster-frame.vercel.app/img/on-chain-cow-neutral-cow.png"
        />
        <meta property="fc:frame" content="vNext" />
        <meta
          property="fc:frame:image"
          content="https://on-chain-cow-farcaster-frame.vercel.app/img/on-chain-cow-neutral-cow.png"
        />
        <meta property="fc:frame:button:1" content="How many On-Chain Cows can you mint?" />
        <meta
          name="fc:frame:post_url"
          content="https://on-chain-cow-farcaster-frame.vercel.app/api/on-chain-cow-farcaster-frame"
        />
      </head>
    </html>
    `);
  }
}
    
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
