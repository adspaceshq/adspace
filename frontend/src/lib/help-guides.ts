import type { SupportTopic } from "@/lib/api/types";

export interface HelpGuide {
  id: string;
  topic: SupportTopic;
  question: string;
  answer: string;
  // Where to go next: in-app paths or full URLs.
  links?: Array<{ href: string; label: string }>;
}

export const HELP_TOPICS: Array<{ topic: SupportTopic; label: string; description: string }> = [
  { topic: "buying", label: "sponsoring", description: "claims, bids and getting your ad in place" },
  { topic: "selling", label: "selling", description: "listing a space, proof and getting paid" },
  { topic: "payments", label: "wallet & payments", description: "USDC, deposits, withdrawals and fees" },
  { topic: "disputes", label: "disputes & refunds", description: "when a delivery goes wrong" },
  { topic: "account", label: "account", description: "sign-in, setup and two-factor" },
];

// Short answers to the questions people ask most. Keep them true to how the app and program work;
// numbers that are settings (review window, dispute timeout) are given as defaults.
export const HELP_GUIDES: HelpGuide[] = [
  // ---- sponsoring ----
  {
    id: "claim-or-bid",
    topic: "buying",
    question: "how do I sponsor a spot?",
    answer:
      "open a listing, pick a spot, and claim it at its price or place a bid if it's an auction. you add your brand name, logo and link at checkout. the creator then puts your brand in place and posts proof.",
    links: [{ href: "/browse", label: "browse spaces" }],
  },
  {
    id: "money-safe",
    topic: "buying",
    question: "is my money safe?",
    answer:
      "your USDC goes into a vault for that one spot on Solana, not to the creator and not to adspaces. the program only releases it by its rules: to the creator after proof and the review window, or back to you as a refund.",
  },
  {
    id: "outbid",
    topic: "buying",
    question: "what happens if I'm outbid?",
    answer: "your USDC comes straight back to your wallet in the same transaction. you can bid again while bidding is open.",
  },
  {
    id: "auction-end",
    topic: "buying",
    question: "how does an auction end?",
    answer:
      "the highest bid when bidding closes wins. a bid in the last 5 minutes extends bidding by 5 minutes, so nobody can snipe at the last second. each listing shows the minimum step for the next bid.",
  },
  {
    id: "delivered",
    topic: "buying",
    question: "how do I know my ad was delivered?",
    answer:
      "you get an email when the creator posts proof. check it on your spot's page. you then have a review window (48 hours by default) to raise a dispute if something's wrong; otherwise the creator is paid.",
    links: [{ href: "/dashboard/sponsor", label: "your spots" }],
  },
  {
    id: "change-brand",
    topic: "buying",
    question: "can I change my logo after buying?",
    answer:
      "your brand is saved at checkout and can't be edited later. if something changed, message the creator in your spot's thread before they put it in place.",
  },
  {
    id: "not-delivered",
    topic: "buying",
    question: "what if the creator doesn't deliver?",
    answer:
      "if there's no proof by the delivery date, take a full refund from your spot's page. if there is proof but it's wrong, open a dispute during the review window.",
  },

  // ---- selling ----
  {
    id: "list-a-space",
    topic: "selling",
    question: "how do I list a space?",
    answer:
      "go to sell, pick a surface, add photos, place your spots on them and set prices (fixed or auction). submit it for review; you see the exact fee and dates before you accept and publish.",
    links: [{ href: "/sell", label: "list a space" }],
  },
  {
    id: "what-to-list",
    topic: "selling",
    question: "what can I list?",
    answer:
      "anything people see: a laptop lid, a t-shirt, a car, a bag or suitcase, a bike, or a digital spot like a stream overlay or a newsletter. up to 60 spots per listing. it has to follow the content policy.",
    links: [{ href: "/content-policy", label: "content policy" }],
  },
  {
    id: "review-time",
    topic: "selling",
    question: "how long does review take?",
    answer:
      "usually within a day. the team may approve it, ask for changes, or decline it. you can edit a listing while it's a draft or has changes requested, but not after it's published, because its terms are fixed on-chain.",
  },
  {
    id: "proof",
    topic: "selling",
    question: "how do I prove delivery?",
    answer:
      "once the sponsor's brand is in place, post an update on your listing (a photo, or a link to your post) and submit it as proof for that spot. it opens the sponsor's review window.",
  },
  {
    id: "get-paid",
    topic: "selling",
    question: "when do I get paid?",
    answer:
      "when the review window ends without a dispute, the payout is ready: your price minus the platform fee, in USDC, to your adspaces wallet. from there you can withdraw anywhere.",
    links: [{ href: "/wallet", label: "your wallet" }],
  },
  {
    id: "cant-deliver",
    topic: "selling",
    question: "what if I can't deliver?",
    answer:
      "refund the sponsor in full from your listing's control room. it's better than missing the delivery date: the sponsor gets their money back straight away instead of waiting for the deadline.",
  },

  // ---- wallet & payments ----
  {
    id: "usdc",
    topic: "payments",
    question: "what money does adspaces use? do I need SOL?",
    answer:
      "USDC on Solana. you get a wallet when you sign in, and adspaces pays the network fees, so you never need SOL. the devnet app uses test USDC with no real value.",
  },
  {
    id: "deposit",
    topic: "payments",
    question: "how do I add USDC?",
    answer:
      "your wallet page shows your deposit address. send USDC on Solana to it. on devnet, get free test USDC from Circle's faucet (pick Solana devnet).",
    links: [
      { href: "/wallet", label: "your wallet" },
      { href: "https://faucet.circle.com", label: "test USDC faucet" },
    ],
  },
  {
    id: "withdraw",
    topic: "payments",
    question: "how do I withdraw?",
    answer:
      "from your wallet page, send USDC to any Solana wallet or exchange. withdrawals need two-factor with an authenticator app, and you approve each one yourself.",
    links: [{ href: "/wallet", label: "your wallet" }],
  },
  {
    id: "fees",
    topic: "payments",
    question: "what are the fees?",
    answer:
      "sponsors pay the listed price, nothing more. creators pay a platform fee when they're paid out: one flat rate for fixed-price listings, and for auctions a base rate plus a capped rate on what's bid above the start. each listing's fee is set at review and shown before you publish.",
    links: [{ href: "/fees", label: "fees in detail" }],
  },

  // ---- disputes & refunds ----
  {
    id: "dispute",
    topic: "disputes",
    question: "how do disputes work?",
    answer:
      "during the review window, the sponsor can dispute the proof with a reason and screenshots. the adspaces team reviews both sides and decides a split; the decision only applies once our 2-of-3 multisig approves it.",
  },
  {
    id: "dispute-evidence",
    topic: "disputes",
    question: "what helps in a dispute?",
    answer:
      "clear evidence: photos or screenshots of where the ad should be, links to posts, and dates. creators can reply with their own in the spot's thread. the team decides on what both sides show.",
  },
  {
    id: "dispute-time",
    topic: "disputes",
    question: "how long does a decision take?",
    answer:
      "usually a day or two. if a dispute isn't decided before its deadline (3 days by default), the sponsor can take a full refund, so a slow decision never leaves you stuck.",
  },
  {
    id: "withdraw-dispute",
    topic: "disputes",
    question: "can I cancel a dispute?",
    answer: "yes, the sponsor can withdraw it from the spot's page. the creator is then paid when the review window ends.",
  },

  // ---- account ----
  {
    id: "sign-in",
    topic: "account",
    question: "how do I sign in?",
    answer: "with Google, X or email. after your first sign-in, a short setup asks what you're here for and confirms your email.",
  },
  {
    id: "change-email",
    topic: "account",
    question: "how do I change my email?",
    answer: "in settings, under your account. notifications and support replies go to that address.",
    links: [{ href: "/settings", label: "settings" }],
  },
  {
    id: "two-factor",
    topic: "account",
    question: "why do I need two-factor?",
    answer:
      "it protects withdrawals, so nobody can move your USDC with just your login. use an authenticator app (like Google Authenticator or 1Password); set it up in settings.",
    links: [{ href: "/settings", label: "settings" }],
  },
];
