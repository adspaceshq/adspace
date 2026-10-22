import type { SupportTopic } from "@/lib/api/types";

export interface HelpGuide {
  id: string;
  topic: SupportTopic;
  question: string;
  answer: string;
}

export const HELP_TOPICS: Array<{ topic: SupportTopic; label: string; description: string }> = [
  { topic: "buying", label: "sponsoring", description: "claims, bids and getting your ad in place" },
  { topic: "selling", label: "selling", description: "listing a space, proof and getting paid" },
  { topic: "payments", label: "wallet & payments", description: "USDC, deposits, withdrawals and fees" },
  { topic: "disputes", label: "disputes & refunds", description: "when a delivery goes wrong" },
  { topic: "account", label: "account", description: "sign-in, setup and two-factor" },
];

// Short answers to the questions people ask most. Keep them true to how the app and program work.
export const HELP_GUIDES: HelpGuide[] = [
  {
    id: "claim-or-bid",
    topic: "buying",
    question: "how do I sponsor a spot?",
    answer:
      "open a listing, pick a spot and claim it (fixed price) or place a bid (auction). your USDC goes into a vault for that spot and stays there until the creator delivers. you'll add your brand name and logo at checkout.",
  },
  {
    id: "outbid",
    topic: "buying",
    question: "what happens if I'm outbid?",
    answer: "your USDC comes straight back to your wallet in the same transaction. you can bid again while bidding is open.",
  },
  {
    id: "not-delivered",
    topic: "buying",
    question: "what if the creator doesn't deliver?",
    answer:
      "if there's no proof by the delivery date, you can take a full refund from the spot page. if there is proof but it's wrong, open a dispute during the review window.",
  },
  {
    id: "list-a-space",
    topic: "selling",
    question: "how do I list a space?",
    answer:
      "go to sell, pick a surface, add photos, place your spots and set prices. we review every listing, usually within a day, and set its fee. you see the exact fee before you accept and publish.",
  },
  {
    id: "proof",
    topic: "selling",
    question: "how do I prove delivery?",
    answer:
      "once the sponsor's brand is in place, post an update on the listing (a photo or a link to your post) and submit it as proof for that spot. the sponsor then has a review window, 48 hours by default.",
  },
  {
    id: "get-paid",
    topic: "selling",
    question: "when do I get paid?",
    answer:
      "when the review window ends without a dispute, the payout is ready: your price minus the platform fee, in USDC, to your wallet.",
  },
  {
    id: "usdc",
    topic: "payments",
    question: "what money does adspaces use?",
    answer:
      "USDC on Solana. you get a wallet when you sign in, and adspaces pays the network fees, so you never need SOL. the devnet app uses test USDC with no real value.",
  },
  {
    id: "withdraw",
    topic: "payments",
    question: "how do I withdraw?",
    answer:
      "from your wallet page, send USDC to any Solana wallet or exchange. withdrawals need two-factor with an authenticator app, and you approve each one yourself.",
  },
  {
    id: "fees",
    topic: "payments",
    question: "what are the fees?",
    answer:
      "creators pay a platform fee when they're paid out; sponsors pay the listed price. fixed-price listings have one flat rate; auctions have a base rate and a capped rate on what's bid above the start. see the fees page for details.",
  },
  {
    id: "dispute",
    topic: "disputes",
    question: "how do disputes work?",
    answer:
      "during the review window, a sponsor can dispute the proof with a reason and screenshots. the adspaces team reviews both sides and decides a split; the decision only applies once our 2-of-3 multisig approves it. if a dispute isn't decided before its deadline, the sponsor can take a full refund.",
  },
  {
    id: "withdraw-dispute",
    topic: "disputes",
    question: "can I cancel a dispute?",
    answer: "yes, the sponsor can withdraw it. the creator is then paid when the review window ends.",
  },
  {
    id: "sign-in",
    topic: "account",
    question: "how do I sign in?",
    answer: "with Google, X or email. after your first sign-in, a short setup asks what you're here for and confirms your email.",
  },
  {
    id: "two-factor",
    topic: "account",
    question: "why do I need two-factor?",
    answer:
      "it protects withdrawals. use an authenticator app (like Google Authenticator or 1Password), which you can set up in settings.",
  },
];
