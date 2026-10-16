import type { Metadata } from "next";
import { LegalList, LegalNotice, LegalPage, LegalSection, SUPPORT_EMAIL, TextLink } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "privacy",
  description: "What adspaces collects, why, who processes it and how to ask for deletion.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage title="privacy" description="what we collect, why, and what you can do about it.">
      <LegalNotice title="the short version">
        <LegalList
          items={[
            "we collect what we need to run your account, listings and payments.",
            "we don't sell your data, and we don't use advertising or tracking cookies.",
            "anything recorded on the Solana blockchain is public and can't be deleted.",
          ]}
        />
      </LegalNotice>

      <LegalSection id="who" title="who we are">
        <p>
          adspaces is a hackathon project run by the adspaces team on the Solana devnet. it is not a registered
          company. you can reach us at <TextLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</TextLink>.
        </p>
      </LegalSection>

      <LegalSection id="collect" title="what we collect">
        <LegalList
          items={[
            "account details from your sign-in through Privy: your email, name and avatar from Google, X or email login, and your X account id if you use X.",
            "your profile: handle, display name, bio, and the onboarding answers you give.",
            "your embedded wallet address and any payout or withdrawal addresses you enter.",
            "what you create: listings, spots, sponsor brand details, logos, proof of delivery, posts, messages and disputes.",
            "images you upload, such as listing photos, logos, proof and dispute evidence.",
            "your notification preferences and the notifications we send you.",
            "basic technical data: IP address and request details in server logs, used for security and rate limiting.",
          ]}
        />
      </LegalSection>

      <LegalSection id="why" title="why we use it">
        <LegalList
          items={[
            "to sign you in and keep your session secure.",
            "to run the marketplace: show listings, process claims, bids, proof, payouts, refunds and disputes.",
            "to send you notifications and emails you asked for, like being outbid or getting paid.",
            "to review listings and resolve disputes.",
            "to prevent abuse, fix bugs and keep the service running.",
          ]}
        />
      </LegalSection>

      <LegalSection id="processors" title="services we use">
        <p>we share data with these providers only so they can run parts of adspaces for us:</p>
        <LegalList
          items={[
            "Privy: sign-in, two-factor authentication and embedded wallets.",
            "Resend: sending emails.",
            "Cloudinary: storing and serving uploaded images.",
            "Supabase: our database.",
            "Render: our backend servers.",
            "Vercel: hosting the website.",
            "Solana: the public blockchain that holds escrow and records listings, spots, bids, proof and disputes.",
          ]}
        />
      </LegalSection>

      <LegalSection id="blockchain" title="the blockchain is public">
        <p>
          wallet addresses, payments, bids, and the hashes and links recorded for proof and disputes are written to
          the Solana blockchain. anyone can read them, and they can&apos;t be changed or deleted, by us or anyone else.
        </p>
      </LegalSection>

      <LegalSection id="cookies" title="cookies and analytics">
        <LegalList
          items={[
            "we use a session cookie to keep you signed in. Privy stores its own sign-in data in your browser.",
            "the listing wizard saves your unfinished draft in your browser so you don't lose it.",
            "we may use Vercel Web Analytics for aggregate, cookieless page-view statistics. it doesn't track you across sites and sets no advertising cookies.",
            "we don't use advertising or cross-site tracking cookies, and we don't sell your data.",
          ]}
        />
      </LegalSection>

      <LegalSection id="public" title="what others can see">
        <p>
          your profile, your listings, the brands you sponsor, proof posts and bid history are public on adspaces.
          messages on a spot are visible to its creator and sponsor, and may be seen by the adspaces team when handling a dispute or a report.
        </p>
      </LegalSection>

      <LegalSection id="retention" title="how long we keep it">
        <p>
          we keep your data while your account is active and as long as needed to settle payments and disputes. as a
          devnet project, we may delete or reset data at any time. server logs are kept for a short time by our
          hosting providers.
        </p>
      </LegalSection>

      <LegalSection id="rights" title="access and deletion">
        <p>
          to get a copy of your data, correct it or delete your account, email{" "}
          <TextLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</TextLink> from the email on your account. we
          will delete what we hold, except what we must keep to settle open payments or disputes. on-chain data
          can&apos;t be deleted.
        </p>
      </LegalSection>

      <LegalSection id="age" title="age">
        <p>adspaces is for people 18 and over. we don&apos;t knowingly collect data from anyone younger.</p>
      </LegalSection>

      <LegalSection id="changes" title="changes">
        <p>
          we may update this policy. the date at the top will change. see also the <TextLink href="/terms">terms</TextLink>.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="contact">
        <p>
          privacy questions? email <TextLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</TextLink>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
