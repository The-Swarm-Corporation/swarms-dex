import { Connection } from "@solana/web3.js";

const RPC_URL = process.env.RPC_URL as string;

export async function POST(req: Request) {
  let signature: string = '';
  try {
    const body = await req.json();
    signature = body.signature;

    if (!signature) {
      return new Response(JSON.stringify({ error: "Missing signature" }), { status: 400 });
    }

    const connection = new Connection(RPC_URL, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 180000
    });

    // Try to confirm with retries
    let confirmed = false;
    let lastError = null;

    // Try up to 30 times with increasing delays (total ~30 seconds)
    for (let i = 0; i < 30; i++) {
      try {
        // Get latest valid blockhash for confirmation
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');

        const confirmation = await connection.confirmTransaction({
          signature,
          blockhash,
          lastValidBlockHeight
        }, 'confirmed');

        if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
          }
        
        // Also verify the transaction succeeded
        const txInfo = await connection.getTransaction(signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0
          });

        if (!txInfo) {
          throw new Error('Transaction info not found');
        }

        if (txInfo.meta?.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(txInfo.meta.err)}`);
        }

        confirmed = true;
        break;

      } catch (error) {
        lastError = error;
        if (i === 29) break; // Last attempt failed
        
        // Exponential backoff with max 2 second delay
        const delay = Math.min(100 * Math.pow(2, i), 2000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    if (!confirmed) {
      console.error('Failed to confirm transaction after retries:', lastError);
      throw new Error('Failed to confirm transaction. Please check the transaction status manually.');
    }

    return new Response(JSON.stringify({ 
      confirmed: true,
      signature: signature 
    }), { status: 200 });

  } catch (error) {
    console.error('Error confirming transaction:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Failed to confirm transaction",
      signature: signature // Return signature even on error so client can link to explorer
    }), { status: 500 });
  }
} 