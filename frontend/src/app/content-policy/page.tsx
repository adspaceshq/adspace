import type { Metadata } from "next";
import { LegalList, LegalPage, LegalSection, SUPPORT_EMAIL, TextLink } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "content policy",
  description: "What ads and listings are allowed on adspaces, and what creators and sponsors must do.",
  alternates: { canonical: "/content-policy" },
};

export default function ContentPolicyPage() {
  return (
    <LegalPage title="content policy" description="what can go on adspaces, and what can't.">
      <LegalSection id="scope" title="what this covers">
        <p>
          this policy covers everything on adspaces: listings, photos, sponsor brands and logos, proof of delivery,
          posts, messages and dispute evidence. it applies to creators and sponsors alike.
        </p>
      </LegalSection>

      <LegalSection id="allowed" title="welcome">
        <LegalList
          items={[
            "real brands, products, projects, communities, events and creators.",
            "honest messages, logos, handles and links.",
            "content that is fine to show in public places, where people of any age may see it.",
          ]}
        />
      </LegalSection>

      <LegalSection id="not-allowed" title="not allowed">
        <LegalList
          items={[
            "scams, phishing, fake giveaways, or anything designed to mislead people.",
            "promises of guaranteed returns, get-rich-quick schemes, or unlicensed financial or investment offers.",
            "gambling and betting promotions.",
            "adult or sexual content.",
            "hate, harassment, or attacks on people for who they are.",
            "violence, threats, or glorifying harm.",
            "illegal goods and services, weapons, drugs, or anything unlawful where it will be shown.",
            "impersonating a person, brand or organization, or implying an endorsement that doesn't exist.",
            "content that infringes someone else's trademark, copyright or other rights.",
            "political campaign ads for candidates, parties or ballot measures.",
            "malware, or links to it.",
            "personal information about someone without their consent.",
          ]}
        />
        <p>
          the creator also has the final say on their own item: they can refuse an ad that doesn&apos;t fit, by
          refunding the sponsor in full.
        </p>
      </LegalSection>

      <LegalSection id="creators" title="creators must">
        <LegalList
          items={[
            "describe the item, placement and audience honestly.",
            "place each ad as agreed: the right logo, spot, size and timing.",
            "keep the ad in place for the period described in the listing.",
            "submit honest proof of delivery. no edited, staged or reused photos.",
            "only list items you own or have the right to put ads on.",
          ]}
        />
      </LegalSection>

      <LegalSection id="sponsors" title="sponsors must">
        <LegalList
          items={[
            "only submit brands, logos and links you have the right to use.",
            "make sure your ad follows this policy and the law where it will be shown.",
            "open disputes in good faith, with honest evidence.",
          ]}
        />
      </LegalSection>

      <LegalSection id="review" title="review">
        <p>
          the adspaces team reviews every listing before it goes live and may reject it, or ask for changes. we may also
          review ads, proof and other content at any time, including when a dispute or report comes in.
        </p>
      </LegalSection>

      <LegalSection id="consequences" title="if the rules are broken">
        <LegalList
          items={[
            "we may hide or remove content, or reject or close a listing.",
            "a dispute may be decided against the person who broke the rules.",
            "we may suspend or close accounts, especially for repeated or serious breaks.",
          ]}
        />
      </LegalSection>

      <LegalSection id="report" title="report something">
        <p>
          see something that breaks this policy? email <TextLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</TextLink>{" "}
          with a link. see also the <TextLink href="/terms">terms</TextLink>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
