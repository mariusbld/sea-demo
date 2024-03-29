import express from 'express';
import * as web3 from '@solana/web3.js';
import * as bodyParser from "body-parser";
import cors from 'cors';
import { Token, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { base58_to_binary } from 'base58-js'

const PORT = process.env.PORT || 8080;
const WATCH_INTERVAL_MS = parseInt(process.env.WATCH_INTERVAL_MS || "0") || 10000;
const RAFFLE_ID = process.env.RAFFLE_ID || 'GVfvCHrkU2rYZDdgGAeXq5eu6GVwgHCiNTUwKzyBbbmw';
const SHIBA_MINT = process.env.SHIBA_MINT || '4UMsJonC4Mk7j843E5avFQLAkdsy256YaK6eXrEyjQi2';// devnet '8XDLdjhwcTxXcdu6mPMRuKdX3rkhiHiVSVkaiQCeny75';
const RPC_ENDPOINT_RAW = process.env.RPC_ENDPOINT || 'https://ssc-dao.genesysgo.net/'; // 'mainnet-beta'; // 'devnet';
const RPC_ENDPOINT = ['devnet', 'testnet', 'mainnet-beta'].includes(RPC_ENDPOINT_RAW) ? 
  web3.clusterApiUrl(RPC_ENDPOINT_RAW as web3.Cluster) : RPC_ENDPOINT_RAW;
const PRIZE_SOL = parseFloat(process.env.PRIZE_SOL) || 0.1;

console.log('-----------------------------');
console.log('Starting with parameters:');
console.log(`Rpc Endpoint: ${RPC_ENDPOINT}`);
console.log(`Prize: ${PRIZE_SOL} SOL`);
console.log(`Watch Interval: ${WATCH_INTERVAL_MS / 1000} sec`);
console.log(`Raffle Id: ${RAFFLE_ID}`);
console.log(`Shiba Mint: ${SHIBA_MINT}`);
console.log('-----------------------------');

const app = express();
app.use(bodyParser.json());
app.use(cors());

let shibaMints = [ SHIBA_MINT ];

var raffleId = new web3.PublicKey(RAFFLE_ID);
// var raffleId =  web3.Keypair.generate().publicKey;
var watcherId = watchTransactions();

var contestants: string[] = [];
let winner: string | undefined = undefined;
var fulfilledSignatures = new Map<string, boolean>();

var connection = new web3.Connection(RPC_ENDPOINT, 'confirmed');

var codedString = '2RT15WD36pqfSyrMtR7YF6x4z2etxxtPtboJ8LR7CVhBrztgG7D9kvoMnoziByMYiCuVogKx2VYvRXwAAf6yvJrL';
var arr = base58_to_binary(codedString);
// Alice (AVr2dcYjJKeAXDKEcNV51Pu9mUZRHT43vRVVJAkgYgsT)
var wallet = web3.Keypair.fromSecretKey(arr);
//  new Uint8Array('2RT15WD36pqfSyrMtR7YF6x4z2etxxtPtboJ8LR7CVhBrztgG7D9kvoMnoziByMYiCuVogKx2VYvRXwAAf6yvJrL'));
  //new Uint8Array([137,178,106,243,4,227,208,10,177,173,164,228,238,216,185,218,9,65,161,221,244,130,177,193,219,89,192,78,245,16,49,183,141,28,225,154,217,145,125,22,200,68,186,162,185,229,153,12,233,240,111,113,71,200,211,222,76,249,156,246,221,84,124,210]));

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.get('/reset-raffle', (req, res) => {
  clearInterval(watcherId);

  raffleId = web3.Keypair.generate().publicKey;
  contestants = [];
  winner = undefined;
  watcherId = watchTransactions();
  fulfilledSignatures.clear();

  res.json({ raffleId, reset: true });
});

app.get('/get-raffle', (req, res) => {
  res.json({ raffleId });
});

app.get('/get-contestants', (req, res) => {
  res.json({ contestants })
});

app.post('/pick-winner', async (req, res) => {
  if (!contestants || !contestants.length) {
    res.json({ winner: undefined });
    return;
  }
  if (winner) {
    res.json({ winner });
    return;
  }
  winner = contestants[Math.floor(Math.random() * contestants.length)];
  await sendPrize(winner);
  res.json({ winner });
});

app.get('/get-winner', (req, res) => {
  res.json({ winner });
});

app.get('/is-winner', (req, res) => {
  const contestant = req.query.wallet as string;
  if (!contestant) {
    res.status(400).end();
    return;
  }
  if (!winner) {
    res.json({ isPending: true });
    return;
  }
  res.json({ winner: winner === contestant, isPending: false });
});

app.listen(PORT, () => {
  return console.log(`Listening at http://localhost:${PORT}`);
});

let processingRefresh = false;
function watchTransactions() {
  return setInterval(() => {
    if (processingRefresh) {
      console.log('already processing..');
      return;
    }
    processingRefresh = true;
    refreshTransactions();
    processingRefresh = false;
  }, WATCH_INTERVAL_MS);
}

async function refreshTransactions() {
  console.log('Refreshing..');

  const sigInfos = await connection.getSignaturesForAddress(raffleId, undefined, 'confirmed');
  const sigs = sigInfos.map(sig => sig.signature);
  const txs = await connection.getParsedTransactions(sigs);
  const sigsToWallet = new Map<string, string>();

  txs.map(tx => {
    const sig = tx.transaction.signatures[0];
    const wallet = tx.transaction.message.accountKeys.find(key => key.signer).pubkey.toString();
    sigsToWallet.set(sig, wallet);
  });

  await fulfillOrders(sigsToWallet);

  const signers = txs.map(tx => tx.transaction.message.accountKeys.find(key => key.signer));
  const signerWallets = signers.map(signer => signer.pubkey.toString());

  contestants = signerWallets;
}

async function fulfillOrders(sigsToWallet: Map<string, string>) {
  for (let [sig, wallet] of sigsToWallet.entries()) {
    if (fulfilledSignatures.get(sig)) {
      continue;
    }
    console.log(`fulfill: sig=${sig} wallet=${wallet}`);
    fulfilledSignatures.set(sig, true);
    await sendNftToBuyer(wallet);
  }
}

async function sendNftToBuyer(buyer: string) {
  const nft = shibaMints[0];
  const buyerWallet = new web3.PublicKey(buyer);
  const mint = new web3.PublicKey(nft);

  const src = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID, 
    TOKEN_PROGRAM_ID, 
    mint, wallet.publicKey);

  const token = new Token(connection, mint, TOKEN_PROGRAM_ID, wallet);
  const dstInfo = await token.getOrCreateAssociatedAccountInfo(buyerWallet);
  const dst = dstInfo.address;

  // const ixa = Token.createAssociatedTokenAccountInstruction(
  //   ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, mint, dst, new web3.PublicKey(buyer), wallet.publicKey);
  
  const ix = Token.createTransferInstruction(
    TOKEN_PROGRAM_ID, src, dst, wallet.publicKey, [], 1);
  
  const transferSig = await connection.sendTransaction(
    new web3.Transaction().add(ix), [wallet]);

  await connection.confirmTransaction(transferSig);

  console.log(`--> sent NFT to ${buyer}`);
}

async function sendPrize(recipient: string) {
  //   var airdropSignature = await connection.requestAirdrop(
  //   new web3.PublicKey(recipient),
  //   web3.LAMPORTS_PER_SOL,
  // );
  // recipient = '5YTDtGXhF5LTd5qDHQuyUYXycj4fjXKjEPK2cuSZCcJp';
  const transferIx = web3.SystemProgram.transfer({
    fromPubkey: wallet.publicKey,
    toPubkey: new web3.PublicKey(recipient),
    lamports: web3.LAMPORTS_PER_SOL * PRIZE_SOL
  });

  const transferSig = await connection.sendTransaction(
    new web3.Transaction().add(transferIx), [wallet]);

  //wait for tranfser confirmation
  await connection.confirmTransaction(transferSig);
  console.log(`sent 0.1 SOL to ${recipient}`);
}
