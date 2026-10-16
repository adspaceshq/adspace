import type { Metadata } from "next";
import {
  LEGAL_UPDATED,
  LegalList,
  LegalNotice,
  LegalPage,
  LegalSection,
  SUPPORT_EMAIL,
  TERMS_VERSION,
  TextLink,
} from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "terms",
  description: "The terms for using adspaces, a devnet marketplace for ad space on physical items.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage
      title="terms"
      description="the rules for using adspaces, in plain words."
      meta={`version ${TERMS_VERSION} · last updated ${LEGAL_UPDATED}`}
    >
      <LegalNotice title="test network only">
        <LegalList
          items={[
            "adspaces runs on the Solana devnet, a test network. no real money moves here.",
            "the USDC used on adspaces is a test token. it has no value and can't be exchanged for money.",
            "the service, its data and its balances may be reset, changed or shut down at any time.",
            "adspaces is a hackathon project run by the adspaces team. it is not a registered company.",
            "everything is provided as is, with no promises.",
          ]}
        />
      </LegalNotice>

      <LegalSection id="agreement" title="these terms">
        <p>
          by using adspaces you agree to these terms, the <TextLink href="/content-policy">content policy</TextLink> and
          the <TextLink href="/privacy">privacy policy</TextLink>. if you don&apos;t agree, please don&apos;t use the
          service. &quot;we&quot; means the adspaces team. &quot;creator&quot; means someone who lists ad space.
          &quot;sponsor&quot; means someone who claims or bids on a spot.
        </p>
      </LegalSection>

      <LegalSection id="who" title="who can use adspaces">
        <p>you must be at least 18 years old and able to agree to these terms where you live.</p>
      </LegalSection>

      <LegalSection id="accounts" title="accounts and wallets">
        <LegalList
          items={[
            "you sign in with Google, X or email through Privy. Privy creates an embedded Solana wallet for your account.",
            "you are responsible for your login and for keeping two-factor authentication safe. we can't reset Privy security settings for you.",
            "you are responsible for what happens under your account, and for the wallet addresses you send funds to.",
            "transactions on a blockchain can't be undone once confirmed.",
            "we pay the network fees and account rent for actions you take in the app, so you don't need SOL.",
          ]}
        />
      </LegalSection>

      <LegalSection id="how" title="how listings work">
        <LegalList
          items={[
            "a creator lists ad space on a physical item, such as a laptop lid, shirt or car, split into spots.",
            "the adspaces team reviews each listing before it goes live. we set the fee and the review window at that point and may reject a listing.",
            "the creator accepts these terms when publishing. the listing and its spots are then created on Solana.",
            "each listing is either fixed price, where sponsors claim a spot at its price, or an auction, where sponsors bid until the listing closes.",
            "in an auction, a bid can't be withdrawn. if you are outbid, your bid comes straight back to your wallet. a bid near the close may extend the close by a few minutes.",
          ]}
        />
      </LegalSection>

      <LegalSection id="escrow" title="escrow, proof and payment">
        <LegalList
          items={[
            "when a sponsor claims or wins a spot, the USDC is held in an on-chain escrow for that spot. neither the creator nor we can move it outside the rules below.",
            "after sales close, the creator places the sponsor's ad as described in the listing and submits proof of delivery before the delivery date.",
            "the sponsor then has a review window, shown on the listing, to check the proof.",
            "if the sponsor doesn't dispute in time, the payment can be released to the creator, minus the platform fee.",
            "if no proof is submitted by the delivery date, the sponsor can be refunded in full.",
            "a creator can refund a sponsor in full at any time before payment is released, unless a dispute is open.",
          ]}
        />
      </LegalSection>

      <LegalSection id="disputes" title="disputes">
        <LegalList
          items={[
            "a sponsor can open a dispute after the delivery date, and before the review window ends if proof was submitted. a dispute needs a short reason, and you can attach images as evidence.",
            "the sponsor can withdraw a dispute while it is still open.",
            "disputes are decided by the adspaces team through a 2-of-3 multisig. we can split the escrow in any proportion between sponsor and creator.",
            "if a dispute isn't decided within the dispute timeout (currently 3 days), the sponsor can be refunded in full.",
            "our decision on a dispute is final on adspaces.",
          ]}
        />
      </LegalSection>

      <LegalSection id="fees" title="fees">
        <p>
          we take a platform fee only when a creator is paid. refunds carry no fee. the exact fee for each listing is shown
          before it is published. see <TextLink href="/fees">fees</TextLink> for how it is worked out.
        </p>
      </LegalSection>

      <LegalSection id="content" title="content">
        <p>
          listings, ads, proof, messages and anything else you upload must follow the{" "}
          <TextLink href="/content-policy">content policy</TextLink>. you keep ownership of what you upload. you give us
          permission to store, display and share it as needed to run adspaces. you confirm you have the rights to
          everything you upload.
        </p>
      </LegalSection>

      <LegalSection id="prohibited" title="what you must not do">
        <LegalList
          items={[
            "break the law or help someone else break it.",
            "post content that breaks the content policy.",
            "submit false proof, or open disputes in bad faith.",
            "bid on or claim your own spots, or use other accounts to inflate prices.",
            "attack, overload, scrape or try to break into the service, the program or other users' accounts.",
            "use adspaces to launder funds, run scams or mislead others.",
            "impersonate anyone.",
          ]}
        />
        <p>we may hide content, reject or remove listings, and suspend accounts that break these rules.</p>
      </LegalSection>

      <LegalSection id="warranty" title="no warranties">
        <p>
          adspaces is an experimental hackathon project on a test network. it is provided &quot;as is&quot; and &quot;as
          available&quot;, without warranties of any kind. it may have bugs, downtime or errors, and on-chain programs may
          behave in ways we didn&apos;t expect. we don&apos;t guarantee that any ad will be delivered, seen or effective.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="limitation of liability">
        <p>
          to the extent the law allows, the adspaces team is not liable for any loss or damage from using adspaces,
          including lost test tokens, lost data, failed transactions or disputes between creators and sponsors. since
          no real money is used, you agree not to rely on adspaces for anything of real value.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="changes to these terms">
        <p>
          we may update these terms. the version and date at the top will change. creators accept the current version
          when they publish a listing. if you keep using adspaces after a change, you accept the new terms.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="contact">
        <p>
          questions about these terms? email <TextLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</TextLink>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
