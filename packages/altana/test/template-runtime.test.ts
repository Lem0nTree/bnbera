import { test } from "node:test";
import assert from "node:assert/strict";
import { erc8183ManifestHash, signerFromPrivateKey, type Erc8183Job, type Session } from "@altananetwork/sdk";
import { decodeFunctionData, hexToString, type Address, type Hex } from "viem";
import {
  BoundedRuntimeError,
  EXECUTE_ACTION,
  PINNED_ERC8183,
  PINNED_PANCAKESWAP,
  deserializeStudioSession,
  executeBoundedSwap,
  parseJobDescription,
  parseExecutionRequest,
  readCompiledConfiguration,
} from "../../../templates/pancakeswap-one-shot/app/agent/src/unifiedMain.ts";

const PRIVATE_KEY = `0x${"11".repeat(32)}` as Hex;
const WALLET = "0x23bb79742B18fE2aF238dDE9eF97f355721c9122" as Address;
const NOW = 1_700_000_000;
const HASH_A = `0x${"aa".repeat(32)}` as Hex;
const HASH_B = `0x${"bb".repeat(32)}` as Hex;
const CONFIG = readCompiledConfiguration();
const JOB_DESCRIPTION = JSON.stringify({
  action: "execute_paid_swap",
  template: "pancakeswap-one-shot@1.1.0",
  configurationDigest: "183d368911ab7d2b0cde381dae1076aa0305bb58e9c830bd986e039fd678034b",
  tradingPair: CONFIG.tradingPair,
  inputAmountWei: CONFIG.inputAmountWei,
});

function studioSessionJson(withSubmit = false): string {
  const signer = signerFromPrivateKey(PRIVATE_KEY);
  return JSON.stringify({
    version: 1,
    walletAddress: WALLET,
    publicKey: signer.publicKey,
    expiry: NOW + 3_600,
    permissions: {
      calls: [
        {
          to: PINNED_PANCAKESWAP.router,
          signature: "swapExactETHForTokens(uint256,address[],address,uint256)",
        },
        ...(withSubmit
          ? [{ to: PINNED_ERC8183.commerce, signature: "submit(uint256,bytes32,bytes)" }]
          : []),
      ],
      spend: [{ limit: { $bigint: "2000000000000000" }, period: "hour" }],
    },
    signer: { type: "privateKey", privateKey: PRIVATE_KEY },
  });
}

async function session(withSubmit = false): Promise<Session> {
  return deserializeStudioSession(studioSessionJson(withSubmit));
}

function fundedJob(provider: Address, description = JOB_DESCRIPTION): Erc8183Job {
  return {
    id: 1n,
    client: "0x1111111111111111111111111111111111111111",
    provider,
    evaluator: PINNED_ERC8183.router,
    description,
    budget: 1_000_000_000_000_000n,
    expiredAt: BigInt(NOW + 900),
    status: 1,
    statusName: "FUNDED",
    hook: PINNED_ERC8183.router,
    submittedAt: 0n,
    deliverable: `0x${"00".repeat(32)}`,
  };
}

function dependencies(currentSession: Session, overrides: Record<string, unknown> = {}) {
  return {
    loadSession: async (raw: string) => {
      assert.equal(raw, "injected-session");
      return currentSession;
    },
    nowUnix: () => NOW,
    getChainId: async () => 97,
    getBlockNumber: async () => 123n,
    readJob: async () => fundedJob(currentSession.walletAddress),
    readPaymentToken: async () => PINNED_ERC8183.paymentToken,
    readFactoryPair: async () => PINNED_PANCAKESWAP.pairs["tbnb-cake"].pair,
    readAmountsOut: async (amount: bigint, path: readonly [Address, Address], block: bigint) => {
      assert.equal(amount, 1_000_000_000_000_000n);
      assert.deepEqual(path, [PINNED_PANCAKESWAP.wbnb, PINNED_PANCAKESWAP.pairs["tbnb-cake"].token]);
      assert.equal(block, 123n);
      return [amount, 1_000_000n] as const;
    },
    execute: async () => ({ status: "CONFIRMED" as const, callsId: HASH_A, transactionHash: HASH_B }),
    ...overrides,
  };
}

async function withSession<T>(value: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.ALTANA_SESSION;
  process.env.ALTANA_SESSION = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.ALTANA_SESSION;
    else process.env.ALTANA_SESSION = previous;
  }
}

test("only the exact execute_swap/jobId request is accepted", () => {
  assert.deepEqual(parseExecutionRequest({ action: EXECUTE_ACTION, jobId: "1" }), {
    action: EXECUTE_ACTION,
    jobId: "1",
  });
  assert.equal(parseExecutionRequest({ action: "quote_plan", jobId: "1" }), null);
  assert.equal(parseExecutionRequest({ action: EXECUTE_ACTION, jobId: "1", target: "0x" }), null);
  assert.equal(parseExecutionRequest({ action: EXECUTE_ACTION, jobId: 1 }), null);
  assert.equal(parseExecutionRequest({ action: EXECUTE_ACTION, jobId: "01" }), null);
});

test("Studio session JSON restores bigint spend and never serializes the signer key", async () => {
  const restored = await session();
  assert.equal(restored.walletAddress.toLowerCase(), WALLET.toLowerCase());
  assert.equal(restored.permissions.spend?.[0]?.limit, 2_000_000_000_000_000n);
  const safeJson = JSON.stringify(restored, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString(10) : value,
  );
  assert.equal(safeJson.includes(PRIVATE_KEY), false);
});

test("job description is an exact binding to the compiled configuration", () => {
  assert.equal(parseJobDescription(JOB_DESCRIPTION, CONFIG), true);
  assert.equal(parseJobDescription(JSON.stringify({ ...JSON.parse(JOB_DESCRIPTION), inputAmountWei: "500000000000000" }), CONFIG), false);
  assert.equal(parseJobDescription(JSON.stringify({ ...JSON.parse(JOB_DESCRIPTION), extra: "reject" }), CONFIG), false);
});

test("missing submit permission fails closed before any execution", async () => {
  const currentSession = await session();
  let chainReads = 0;
  let executeCalls = 0;
  await withSession("injected-session", async () => {
    await assert.rejects(
      executeBoundedSwap("1", dependencies(currentSession, {
        getChainId: async () => { chainReads += 1; return 97; },
        execute: async () => { executeCalls += 1; return { status: "CONFIRMED" as const }; },
      })),
      (error: unknown) => error instanceof BoundedRuntimeError && error.code === "ALTANA_SESSION_UNAUTHORIZED",
    );
  });
  assert.equal(chainReads, 0);
  assert.equal(executeCalls, 0);
});

test("confirmed execution derives the pinned swap and submit calls and returns public evidence", async () => {
  const currentSession = await session(true);
  let captured: readonly { to: Address; value?: bigint; data?: Hex }[] = [];
  let submittedDeliverable: Hex | undefined;
  let reads = 0;
  const result = await withSession("injected-session", () =>
    executeBoundedSwap(
      "1",
      dependencies(currentSession, {
        readJob: async () => {
          reads += 1;
          return submittedDeliverable === undefined || reads === 1
            ? fundedJob(currentSession.walletAddress)
            : { ...fundedJob(currentSession.walletAddress), status: 2, statusName: "SUBMITTED" as const, deliverable: submittedDeliverable };
        },
        execute: async (_session: Session, calls: readonly { to: Address; value?: bigint; data?: Hex }[]) => {
          captured = calls;
          const decoded = decodeFunctionData({
            abi: [{ type: "function", name: "submit", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "bytes32" }, { type: "bytes" }], outputs: [] }] as const,
            data: calls[1]?.data as Hex,
          });
          submittedDeliverable = decoded.args[1];
          return { status: "CONFIRMED" as const, callsId: HASH_A, transactionHash: HASH_B };
        },
      }),
    ),
  );

  assert.equal(result.outcome, "confirmed");
  assert.equal(result.execution.transactionHash, HASH_B);
  assert.equal(result.resultSubmission.status, "confirmed");
  assert.equal(captured.length, 2);
  assert.equal(captured[0]?.to.toLowerCase(), PINNED_PANCAKESWAP.router.toLowerCase());
  assert.equal(captured[0]?.value, 1_000_000_000_000_000n);
  assert.equal(captured[0]?.data?.startsWith(PINNED_PANCAKESWAP.selector), true);
  assert.equal(captured[1]?.to.toLowerCase(), PINNED_ERC8183.commerce.toLowerCase());
  const deliverableUrl = result.resultSubmission.deliverableUrl;
  if (deliverableUrl === undefined) throw new Error("missing canonical deliverable URL");
  assert.match(deliverableUrl, /^data:application\/json;base64,/u);
  const manifestText = Buffer.from(deliverableUrl.slice("data:application/json;base64,".length), "base64").toString("utf8");
  assert.equal(erc8183ManifestHash(JSON.parse(manifestText)), result.resultSubmission.deliverable);
  assert.equal(JSON.stringify(result).includes(PRIVATE_KEY), false);
});

test("pending relay outcome is unknown and never retried", async () => {
  const currentSession = await session(true);
  let executeCalls = 0;
  const result = await withSession("injected-session", () =>
    executeBoundedSwap(
      "1",
      dependencies(currentSession, {
        execute: async () => {
          executeCalls += 1;
          return { status: "PENDING" as const, callsId: HASH_A };
        },
      }),
    ),
  );
  assert.equal(result.outcome, "unknown");
  assert.equal(result.execution.status, "PENDING");
  assert.equal(executeCalls, 1);
});

test("canonical ERC-8183 submission uses the exact permission and data URL", async () => {
  const currentSession = await session(true);
  let submittedUrl = "";
  let submittedDeliverable: Hex | undefined;
  let reads = 0;
  const result = await withSession("injected-session", () =>
    executeBoundedSwap(
      "1",
      dependencies(currentSession, {
        readJob: async () => {
          reads += 1;
          return submittedDeliverable === undefined || reads === 1
            ? fundedJob(currentSession.walletAddress)
            : { ...fundedJob(currentSession.walletAddress), status: 2, statusName: "SUBMITTED" as const, deliverable: submittedDeliverable };
        },
        execute: async (_session: Session, calls: readonly { to: Address; value?: bigint; data?: Hex }[]) => {
          assert.equal(calls.length, 2);
          assert.equal(calls[1]?.to.toLowerCase(), PINNED_ERC8183.commerce.toLowerCase());
          const decoded = decodeFunctionData({
            abi: [{ type: "function", name: "submit", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "bytes32" }, { type: "bytes" }], outputs: [] }] as const,
            data: calls[1]?.data as Hex,
          });
          submittedDeliverable = decoded.args[1];
          submittedUrl = (JSON.parse(hexToString(decoded.args[2])) as { deliverable_url: string }).deliverable_url;
          return { status: "CONFIRMED" as const, callsId: HASH_A, transactionHash: HASH_B };
        },
      }),
    ),
  );
  assert.match(submittedUrl, /^data:application\/json;base64,/u);
  assert.equal(result.resultSubmission?.status, "confirmed");
  assert.equal(result.resultSubmission?.deliverable?.startsWith("0x"), true);
});

test("mismatched on-chain job description is rejected before quote or execute", async () => {
  const currentSession = await session(true);
  let quoteCalls = 0;
  let executeCalls = 0;
  await withSession("injected-session", async () => {
    await assert.rejects(
      executeBoundedSwap("1", dependencies(currentSession, {
        readJob: async () => fundedJob(currentSession.walletAddress, JSON.stringify({ ...JSON.parse(JOB_DESCRIPTION), tradingPair: "tbnb-busd" })),
        readAmountsOut: async () => { quoteCalls += 1; return [1n, 1n] as const; },
        execute: async () => { executeCalls += 1; return { status: "CONFIRMED" as const }; },
      })),
      (error: unknown) => error instanceof BoundedRuntimeError && error.code === "JOB_DESCRIPTION_MISMATCH",
    );
  });
  assert.equal(quoteCalls, 0);
  assert.equal(executeCalls, 0);
});

test("missing ALTANA_SESSION fails closed before any chain seam is touched", async () => {
  const previous = process.env.ALTANA_SESSION;
  delete process.env.ALTANA_SESSION;
  try {
    await assert.rejects(
      executeBoundedSwap("1", { getChainId: async () => 97 }),
      (error: unknown) =>
        error instanceof BoundedRuntimeError && error.code === "ALTANA_SESSION_REQUIRED",
    );
  } finally {
    if (previous !== undefined) process.env.ALTANA_SESSION = previous;
  }
});
