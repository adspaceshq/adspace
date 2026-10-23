import * as multisig from "@sqds/multisig";
import { PublicKey, type Connection } from "@solana/web3.js";

// The platform's own wallets and their SOL, for the admin wallets page. Every address is discovered
// (server keys, the program's Config, ProgramData and the Squads multisig), so the page follows a key
// rotation or a new cluster without config.
export type OpsRole = "fee_payer" | "reviewer" | "proposer" | "config_authority" | "upgrade_authority" | "treasury" | "guardian" | "member";

// SOL per role: below `min` the wallet is flagged low; `target` is what to top it up to.
// Fee payer: rent for every listing, spot and proof (about 0.055 SOL per 10-spot listing, returned on close).
// Proposer: about 0.005 rent per Squads proposal. Guardian and members: only transaction fees.
// The admin vault keeps a little for a future `program extend`; upgrade authority and treasury need none.
export const WALLET_LEVELS: Record<OpsRole, { min: number; target: number }> = {
  fee_payer: { min: 1, target: 3 },
  proposer: { min: 0.05, target: 0.2 },
  config_authority: { min: 0.01, target: 0.05 },
  guardian: { min: 0.005, target: 0.01 },
  member: { min: 0.005, target: 0.02 },
  reviewer: { min: 0, target: 0 },
  upgrade_authority: { min: 0, target: 0 },
  treasury: { min: 0, target: 0 },
};

export interface OpsWallet {
  address: string;
  // One key can hold several roles (on devnet the reviewer also pays fees and proposes).
  roles: OpsRole[];
  sol: number | null;
  minSol: number;
  targetSol: number;
  // null when the balance could not be read.
  low: boolean | null;
  // Treasury only: its USDC balance in base units.
  usdc: bigint | null;
}

// Squads permission bits.
const VOTE = 2;

// Groups role entries by address; a shared key takes the strictest level of its roles.
export function mergeWallets(entries: Array<{ address: string; role: OpsRole }>, levels = WALLET_LEVELS) {
  const byAddress = new Map<string, OpsRole[]>();
  for (const { address, role } of entries) {
    const roles = byAddress.get(address) ?? [];
    if (!roles.includes(role)) roles.push(role);
    byAddress.set(address, roles);
  }
  return [...byAddress].map(([address, roles]) => ({
    address,
    roles,
    minSol: Math.max(...roles.map((role) => levels[role].min)),
    targetSol: Math.max(...roles.map((role) => levels[role].target)),
  }));
}

// ProgramData: enum tag (4) + slot (8) + Option<Pubkey> (1 + 32). Program: enum tag (4) + programdata (32).
async function readUpgradeAuthority(connection: Connection, programId: PublicKey) {
  const program = await connection.getAccountInfo(programId, "confirmed");
  if (!program || program.data.length < 36) return null;
  const programData = await connection.getAccountInfo(new PublicKey(program.data.subarray(4, 36)), "confirmed");
  if (!programData || programData.data.length < 45 || programData.data[12] !== 1) return null;
  return new PublicKey(programData.data.subarray(13, 45));
}

export async function readOpsWallets(
  chain: {
    connection: Connection;
    program: { programId: PublicKey };
    rentPayer: { publicKey: PublicKey };
    reviewer: { publicKey: PublicKey };
    squads?: { multisig: PublicKey; proposer: { publicKey: PublicKey } };
    readProtocolStatus: () => Promise<{ authority: PublicKey; treasury: PublicKey; pauseGuardian: PublicKey | null }>;
    readTokenBalance: (owner: PublicKey) => Promise<bigint>;
  },
  minFeePayerLamports: number,
): Promise<OpsWallet[]> {
  const entries: Array<{ address: string; role: OpsRole }> = [
    { address: chain.rentPayer.publicKey.toBase58(), role: "fee_payer" },
    { address: chain.reviewer.publicKey.toBase58(), role: "reviewer" },
  ];
  if (chain.squads) entries.push({ address: chain.squads.proposer.publicKey.toBase58(), role: "proposer" });

  // Each discovery is independent: one failing read drops its rows, not the page.
  const [status, upgradeAuthority, members] = await Promise.all([
    chain.readProtocolStatus().catch(() => null),
    readUpgradeAuthority(chain.connection, chain.program.programId).catch(() => null),
    chain.squads
      ? multisig.accounts.Multisig.fromAccountAddress(chain.connection, chain.squads.multisig).then(
          (account) => account.members.filter((member) => (member.permissions.mask & VOTE) !== 0).map((member) => member.key),
          () => [] as PublicKey[],
        )
      : Promise.resolve([] as PublicKey[]),
  ]);
  if (status) {
    entries.push({ address: status.authority.toBase58(), role: "config_authority" });
    entries.push({ address: status.treasury.toBase58(), role: "treasury" });
    if (status.pauseGuardian) entries.push({ address: status.pauseGuardian.toBase58(), role: "guardian" });
  }
  if (upgradeAuthority) entries.push({ address: upgradeAuthority.toBase58(), role: "upgrade_authority" });
  for (const member of members) entries.push({ address: member.toBase58(), role: "member" });

  const levels = { ...WALLET_LEVELS, fee_payer: { ...WALLET_LEVELS.fee_payer, min: minFeePayerLamports / 1e9 } };
  const wallets = mergeWallets(entries, levels);
  const accounts = await chain.connection
    .getMultipleAccountsInfo(wallets.map((wallet) => new PublicKey(wallet.address)), "confirmed")
    .catch(() => null);
  return Promise.all(
    wallets.map(async (wallet, index) => {
      // A wallet that was never funded has no account: 0 SOL, not unknown.
      const sol = accounts ? (accounts[index]?.lamports ?? 0) / 1e9 : null;
      const usdc = wallet.roles.includes("treasury") ? await chain.readTokenBalance(new PublicKey(wallet.address)).catch(() => null) : null;
      return { ...wallet, sol, low: sol === null ? null : sol < wallet.minSol, usdc };
    }),
  );
}
