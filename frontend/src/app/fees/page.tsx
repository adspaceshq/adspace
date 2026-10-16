import type { Metadata } from "next";
import { LegalList, LegalNotice, LegalPage, LegalSection, TextLink } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "fees",
  description: "How the adspaces platform fee works for fixed-price listings, auctions and disputes.",
  alternates: { canonical: "/fees" },
};

function Example({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4 text-body">
      {rows.map(([label, value], index) => (
        <div
          key={label}
          className={index === rows.length - 1 ? "flex justify-between gap-4 border-t border-line pt-2 font-semibold" : "flex justify-between gap-4"}
        >
          <dt className={index === rows.length - 1 ? "text-ink" : "text-muted"}>{label}</dt>
          <dd className="font-mono tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function FeesPage() {
  return (
    <LegalPage title="fees" description="what the platform fee is, when it's taken, and who pays what.">
      <LegalNotice title="the short version">
        <LegalList
          items={[
            "creators pay a platform fee only when they get paid. sponsors pay the spot price or their bid, nothing more.",
            "refunds carry no fee.",
            "we pay the Solana network fees and account rent.",
            "on devnet, all amounts are test USDC with no real value.",
          ]}
        />
      </LegalNotice>

      <LegalSection id="set" title="how the fee is set">
        <p>
          the adspaces team sets the fee for each listing when reviewing it, never below the platform minimum. the creator
          sees the exact fee before publishing, and it is fixed on-chain with the listing. it can&apos;t be changed later.
          the fee is taken from the escrow when the creator is paid and sent to the platform treasury. all amounts round
          down to the smallest USDC unit (0.000001).
        </p>
      </LegalSection>

      <LegalSection id="fixed" title="fixed-price listings">
        <p>the fee is a flat percentage of the spot price.</p>
        <p className="font-mono text-small">fee = price × fee %</p>
        <p>example: a $10 spot with a 2.5% fee.</p>
        <Example
          rows={[
            ["sponsor pays", "$10.00"],
            ["platform fee (2.5% of $10)", "$0.25"],
            ["creator receives", "$9.75"],
          ]}
        />
      </LegalSection>

      <LegalSection id="auction" title="auctions">
        <p>
          auctions use three numbers: a base % on the starting price, an uplift % on anything bid above the starting
          price, and a cap % on the whole winning bid. the fee is whichever is lower: base plus uplift, or the cap.
        </p>
        <p className="font-mono text-small">
          fee = min(start × base % + (bid − start) × uplift %, bid × cap %)
        </p>
        <p>example: start price $10, base 2.5%, uplift 20%, cap 10%.</p>
        <Example
          rows={[
            ["winning bid", "$12.00"],
            ["base: 2.5% of $10", "$0.25"],
            ["uplift: 20% of $2", "$0.40"],
            ["cap: 10% of $12 = $1.20, not reached", "fee $0.65"],
            ["creator receives", "$11.35"],
          ]}
        />
        <p>if the bidding goes much higher, the cap kicks in:</p>
        <Example
          rows={[
            ["winning bid", "$50.00"],
            ["base + uplift: $0.25 + 20% of $40", "$8.25"],
            ["cap: 10% of $50", "$5.00"],
            ["fee (the lower of the two)", "$5.00"],
            ["creator receives", "$45.00"],
          ]}
        />
        <p>if you are outbid, your bid comes back in full with no fee.</p>
      </LegalSection>

      <LegalSection id="disputes" title="disputes">
        <p>
          when the adspaces team decides a dispute, it splits the escrow between the sponsor and the creator. the fee is
          the listing&apos;s normal fee, scaled by the creator&apos;s share. the sponsor&apos;s part is refunded with no
          fee.
        </p>
        <p className="font-mono text-small">fee = normal fee × creator share %</p>
        <p>example: a $1 spot with a 2.5% fee, split 50/50.</p>
        <Example
          rows={[
            ["escrow", "$1.00"],
            ["sponsor refund (50%)", "$0.50"],
            ["normal fee 2.5% of $1 = $0.025, × 50%", "fee $0.0125"],
            ["creator receives", "$0.4875"],
          ]}
        />
        <p>
          if a dispute isn&apos;t decided within the dispute timeout (currently 3 days), the sponsor is refunded in full
          with no fee.
        </p>
      </LegalSection>

      <LegalSection id="refunds" title="refunds">
        <p>
          refunds return the full escrow to the sponsor, with no fee. this covers missed delivery, a creator refunding a
          sponsor, and dispute timeouts.
        </p>
      </LegalSection>

      <LegalSection id="network" title="network fees and rent">
        <p>
          Solana charges small network fees and a refundable deposit (rent) for the on-chain accounts behind each
          listing, spot, escrow, proof and dispute. we pay these for you, and the rent comes back to us when the
          accounts close.
        </p>
      </LegalSection>

      <LegalSection id="more" title="more">
        <p>
          see the <TextLink href="/terms">terms</TextLink> for how escrow, proof and disputes work.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
