"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const web3 = __importStar(require("@solana/web3.js"));
const bodyParser = __importStar(require("body-parser"));
const cors_1 = __importDefault(require("cors"));
const spl_token_1 = require("@solana/spl-token");
const PORT = process.env.PORT || 8080;
const app = (0, express_1.default)();
app.use(bodyParser.json());
app.use((0, cors_1.default)());
let shibaMints = [
    '8XDLdjhwcTxXcdu6mPMRuKdX3rkhiHiVSVkaiQCeny75'
];
var raffleId = new web3.PublicKey('914uyLYrV5omTCJ4uuPxcbo6yfBZoW2cSxV1xAgjs4wa');
// var raffleId =  web3.Keypair.generate().publicKey;
var watcherId = watchTransactions();
var contestants = [];
let winner = undefined;
var fulfilledSignatures = new Map();
var connection = new web3.Connection(web3.clusterApiUrl('devnet'), 'confirmed');
// Alice (AVr2dcYjJKeAXDKEcNV51Pu9mUZRHT43vRVVJAkgYgsT)
var wallet = web3.Keypair.fromSecretKey(new Uint8Array([137, 178, 106, 243, 4, 227, 208, 10, 177, 173, 164, 228, 238, 216, 185, 218, 9, 65, 161, 221, 244, 130, 177, 193, 219, 89, 192, 78, 245, 16, 49, 183, 141, 28, 225, 154, 217, 145, 125, 22, 200, 68, 186, 162, 185, 229, 153, 12, 233, 240, 111, 113, 71, 200, 211, 222, 76, 249, 156, 246, 221, 84, 124, 210]));
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
    res.json({ contestants });
});
app.post('/pick-winner', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    if (!contestants || !contestants.length) {
        res.json({ winner: undefined });
        return;
    }
    if (winner) {
        res.status(401);
        return;
    }
    winner = contestants[Math.floor(Math.random() * contestants.length)];
    yield sendPrize(winner);
    res.json({ winner });
}));
app.get('/get-winner', (req, res) => {
    res.json({ winner });
});
app.get('/is-winner', (req, res) => {
    const contestant = req.query.wallet;
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
    }, 5000);
}
function refreshTransactions() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('Refreshing..');
        const sigInfos = yield connection.getSignaturesForAddress(raffleId, undefined, 'confirmed');
        const sigs = sigInfos.map(sig => sig.signature);
        const txs = yield connection.getParsedTransactions(sigs);
        const sigsToWallet = new Map();
        txs.map(tx => {
            const sig = tx.transaction.signatures[0];
            const wallet = tx.transaction.message.accountKeys.find(key => key.signer).pubkey.toString();
            sigsToWallet.set(sig, wallet);
        });
        yield fulfillOrders(sigsToWallet);
        const signers = txs.map(tx => tx.transaction.message.accountKeys.find(key => key.signer));
        const signerWallets = signers.map(signer => signer.pubkey.toString());
        contestants = signerWallets;
    });
}
function fulfillOrders(sigsToWallet) {
    return __awaiter(this, void 0, void 0, function* () {
        for (let [sig, wallet] of sigsToWallet.entries()) {
            if (fulfilledSignatures.get(sig)) {
                continue;
            }
            console.log(`fulfill: sig=${sig} wallet=${wallet}`);
            yield sendNftToBuyer(wallet);
            fulfilledSignatures.set(sig, true);
        }
    });
}
function sendNftToBuyer(buyer) {
    return __awaiter(this, void 0, void 0, function* () {
        const nft = shibaMints[0];
        const buyerWallet = new web3.PublicKey(buyer);
        const mint = new web3.PublicKey(nft);
        const src = yield spl_token_1.Token.getAssociatedTokenAddress(spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID, spl_token_1.TOKEN_PROGRAM_ID, mint, wallet.publicKey);
        const token = new spl_token_1.Token(connection, mint, spl_token_1.TOKEN_PROGRAM_ID, wallet);
        const dstInfo = yield token.getOrCreateAssociatedAccountInfo(buyerWallet);
        const dst = dstInfo.address;
        // const ixa = Token.createAssociatedTokenAccountInstruction(
        //   ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, mint, dst, new web3.PublicKey(buyer), wallet.publicKey);
        const ix = spl_token_1.Token.createTransferInstruction(spl_token_1.TOKEN_PROGRAM_ID, src, dst, wallet.publicKey, [], 1);
        const transferSig = yield connection.sendTransaction(new web3.Transaction().add(ix), [wallet]);
        yield connection.confirmTransaction(transferSig);
        console.log(`--> sent NFT to ${buyer}`);
    });
}
function sendPrize(recipient) {
    return __awaiter(this, void 0, void 0, function* () {
        //   var airdropSignature = await connection.requestAirdrop(
        //   new web3.PublicKey(recipient),
        //   web3.LAMPORTS_PER_SOL,
        // );
        // recipient = '5YTDtGXhF5LTd5qDHQuyUYXycj4fjXKjEPK2cuSZCcJp';
        const transferIx = web3.SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: new web3.PublicKey(recipient),
            lamports: web3.LAMPORTS_PER_SOL / 10
        });
        const transferSig = yield connection.sendTransaction(new web3.Transaction().add(transferIx), [wallet]);
        //wait for tranfser confirmation
        yield connection.confirmTransaction(transferSig);
        console.log(`sent 0.1 SOL to ${recipient}`);
    });
}
//# sourceMappingURL=app.js.map