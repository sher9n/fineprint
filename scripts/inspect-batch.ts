import "dotenv/config";
import OpenAI from "openai";

async function main() {
  const batchId = process.argv[2];
  if (!batchId) {
    console.error("usage: tsx scripts/inspect-batch.ts <batch_id>");
    process.exit(1);
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const batch = await client.batches.retrieve(batchId);
  console.log(JSON.stringify({
    id: batch.id,
    status: batch.status,
    endpoint: batch.endpoint,
    input_file_id: batch.input_file_id,
    output_file_id: batch.output_file_id,
    error_file_id: batch.error_file_id,
    errors: batch.errors,
    request_counts: batch.request_counts,
    failed_at: batch.failed_at,
    expired_at: batch.expired_at,
    completed_at: batch.completed_at,
    created_at: batch.created_at,
  }, null, 2));

  if (batch.error_file_id) {
    console.log("\n---- error file ----");
    const errFile = await client.files.content(batch.error_file_id);
    const txt = await errFile.text();
    console.log(txt.slice(0, 4000));
  }
  if (batch.output_file_id) {
    console.log("\n---- output file (first 2000 chars) ----");
    const outFile = await client.files.content(batch.output_file_id);
    const txt = await outFile.text();
    console.log(txt.slice(0, 2000));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
