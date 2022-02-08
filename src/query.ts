import "dotenv/config";
if (process.env.API_KEY == null) {
  console.error("No API_KEY defined in root .env!");
  process.exit(1);
}

import { Contract, ethers } from "ethers";
import fs from "fs/promises";

const INFURA_API_KEY = process.env.API_KEY;
const WETH_ABI = require("./wethabi.json");
const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const START_BLOCK_NUMBER = 14000000; // Jan 13 2022
const BLOCK_PAGINATION_SIZE = 250; // ~700 API calls at current date. Mainly required because infura limits to 10000 results per call
const NUM_ASYNC_CALLS = 100;

const WETH_FILTER_THRESHOLD = ethers.utils.parseEther("1000");

type Event = {
  blockNumber: number;
  transactionHash: string;
  src: string;
  dst: string;
  wad: string;
};

async function main() {
  const provider = new ethers.providers.InfuraProvider(
    "homestead",
    INFURA_API_KEY
  );
  const weth_instance = new Contract(WETH_ADDRESS, WETH_ABI, provider);
  const filter = weth_instance.filters.Transfer();

  const currentBlock = await provider.getBlockNumber();
  console.log(`Current block is: ${currentBlock}`);
  let workingBlock = START_BLOCK_NUMBER;

  const events: Event[] = []; // JS is single threaded, ok for single output obj

  const blockGenerator = (function* () {
    while (workingBlock < currentBlock) {
      yield workingBlock;
      workingBlock += BLOCK_PAGINATION_SIZE;
    }
  })();

  async function worker() {
    for (let block of blockGenerator) {
      const toBlock = block + BLOCK_PAGINATION_SIZE;
      console.log(`Querying ${block} to ${toBlock}`);

      let retries = 2;
      let _events: ethers.Event[] = [];

      do {
        try {
          _events = await weth_instance.queryFilter(filter, block, toBlock);
          break;
        } catch (error: any) {
          console.error(
            `Warning: query from ${block} to ${toBlock} failed, ${retries} remaining`
          );
          retries -= 1;

          if (retries <= 0) {
            console.error(
              "!!!!!! NO RETRIES REMAINING, BLOCKS WILL BE SKIPPED!!!!!"
            );
            console.error(error);
          }
        }
      } while (retries > 0);

      events.push(
        ...(_events ?? [])
          .filter((e) => e.args!.wad.gte(WETH_FILTER_THRESHOLD))
          .map(
            ({
              blockNumber,
              transactionHash,
              args: { src, dst, wad },
            }: any) => {
              return {
                blockNumber,
                transactionHash,
                src,
                dst,
                wad: ethers.utils.formatEther(wad),
              };
            }
          )
      );
    }
  }

  const promises = Array(NUM_ASYNC_CALLS)
    .fill(null)
    .map((_) => worker());

  await Promise.all(promises);

  console.log(`${events.length} records obtained, writing to json`);
  await fs.writeFile(
    `./events.json`,
    JSON.stringify(events.sort((a, b) => a.blockNumber - b.blockNumber))
  );
}

main();
