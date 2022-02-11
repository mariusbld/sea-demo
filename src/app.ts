import express from 'express';
import * as web3 from '@solana/web3.js';
import * as bodyParser from "body-parser";
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 8080;
app.use(bodyParser.json());
app.use(cors());



var raffleId = new web3.PublicKey('4AgY3XGwYL3PGhEeVktLUn16PCjmH2NaXkoN8CsFaXXN'); //web3.Keypair.generate().publicKey;
var watcherId = watchTransactions();

var contestants = [];
let winner: string | undefined = undefined;

var connection = new web3.Connection(
  web3.clusterApiUrl('devnet'),
  'confirmed',
);
var wallet = web3.Keypair.fromSecretKey(new Uint8Array([137,178,106,243,4,227,208,10,177,173,164,228,238,216,185,218,9,65,161,221,244,130,177,193,219,89,192,78,245,16,49,183,141,28,225,154,217,145,125,22,200,68,186,162,185,229,153,12,233,240,111,113,71,200,211,222,76,249,156,246,221,84,124,210]));

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.get('/reset-raffle', (req, res) => {
  clearInterval(watcherId);

  raffleId = web3.Keypair.generate().publicKey;
  contestants = [];
  winner = undefined;
  watcherId = watchTransactions();
  
  const reset = true;
  res.json({ raffleId, reset });
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
    res.status(401);
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
    res.status(400);
    return;
  }
  if (!winner) {
    res.json({ isPending: true });
    return;
  }
  res.json({ winner: winner === contestant, isPending: false });
});

app.listen(PORT, () => {
  return console.log(`Express is listening at http://localhost:${PORT}`);
});

function watchTransactions() {
  return setInterval(() => {
    refreshTransactions();
  }, 3000);
}

async function refreshTransactions() {
  console.log('Refreshing..');
  const sigInfos = await connection.getSignaturesForAddress(raffleId, undefined, 'confirmed');
  const sigs = sigInfos.map(sig => sig.signature);
  const txs = await connection.getParsedTransactions(sigs);
  const signers = txs.map(tx => tx.transaction.message.accountKeys.find(key => key.signer));
  const signerWallets = signers.map(signer => signer.pubkey.toString());
  console.log(signerWallets);
  contestants = signerWallets;
}

async function sendPrize(recipient: string) {
  //   var airdropSignature = await connection.requestAirdrop(
  //   new web3.PublicKey(recipient),
  //   web3.LAMPORTS_PER_SOL,
  // );

  const transferIx = web3.SystemProgram.transfer({
    fromPubkey: wallet.publicKey,
    toPubkey: new web3.PublicKey(recipient),
    lamports: web3.LAMPORTS_PER_SOL
  });

  const transferSig = await connection.sendTransaction(
    new web3.Transaction().add(transferIx), [wallet]);

  //wait for tranfser confirmation
  await connection.confirmTransaction(transferSig);
  console.log(`sent 1 SOL to ${recipient}`);
}

// (async () => {
//   // Generate a new wallet keypair and airdrop SOL
//   var wallet = web3.Keypair.generate();
//   var airdropSignature = await connection.requestAirdrop(
//     wallet.publicKey,
//     web3.LAMPORTS_PER_SOL,
//   );

//   //wait for airdrop confirmation
//   await connection.confirmTransaction(airdropSignature);

//   // get account info
//   // account data is bytecode that needs to be deserialized
//   // serialization and deserialization is program specific
//   let account = await connection.getAccountInfo(wallet.publicKey);
//   console.log(account);
// })();
