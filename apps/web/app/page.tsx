import Link from "next/link";
import { Callout, DataModeBadge, SectionHeading, StatusBadge } from "@bnbera/ui";
import { categoryDescription, categoryLabel } from "@/lib/marketplace-contract";

const categories = [
  { slug: "rebalancing", icon: "R" },
  { slug: "grid-trading", icon: "G" },
  { slug: "yield-optimisation", icon: "Y" },
  { slug: "health-factor", icon: "H" }
] as const;

export default function HomePage() {
  return (
    <div className="page-shell">
      <section className="hero">
        <div>
          <div className="hero__eyebrow">BNB Chain agent marketplace</div>
          <h1>Read the market. <em>Then decide.</em></h1>
          <p className="hero__copy">
            BNBEra makes agent supply legible: identity, provenance, capability, freshness, and independent lifecycle state in one public view.
          </p>
          <div className="hero__actions">
            <Link className="button button--primary" href="/marketplace">Explore marketplace <span aria-hidden="true">→</span></Link>
            <Link className="button button--ghost" href="/compare">Compare up to three</Link>
          </div>
          <p className="hero__note">Core Marketplace gate · read-only W0/W1 slice · no wallet, payment, custody, or transaction side effects.</p>
        </div>
        <div className="hero__art" aria-label="Illustration of an agent marketplace read model">
          <div className="art-card art-card--main" aria-label="Illustrative fixture read-model card">
            <div className="art-card__line">
              <span className="art-card__name">Read-model signal</span>
              <DataModeBadge mode="fixture" label="Illustrative fixture" />
            </div>
            <div className="art-card__metric">6<span style={{ fontSize: "0.8rem", letterSpacing: "0" }}> axes</span></div>
            <div className="art-card__caption">Origin, claim, verification, runtime, authority, and listing stay independent.</div>
            <div className="art-card__line" style={{ marginTop: "1.1rem" }}>
              <StatusBadge value="example only" tone="purple" />
              <StatusBadge value="read-only" tone="neutral" />
            </div>
          </div>
          <div className="art-card art-card--side" aria-label="Illustrative ERC-8004 identity tuple">
            <div className="art-card__name">Identity tuple</div>
            <div className="art-card__caption" style={{ marginTop: "0.55rem" }}>erc8004 · 97 · registry · example ID</div>
          </div>
        </div>
      </section>

      <section className="section-block" aria-labelledby="categories-heading">
        <SectionHeading
          id="categories-heading"
          eyebrow="Four equal lanes"
          title="Browse by job, not by hype."
          description="Each category uses the same read contract, state axes, provenance labels, and unavailable activation treatment."
          action={<Link className="text-link" href="/marketplace">See all supply →</Link>}
        />
        <div className="category-grid">
          {categories.map(({ slug, icon }) => (
            <Link className="category-card" href={`/marketplace/${slug}`} key={slug}>
              <span className="category-card__icon" aria-hidden="true">{icon}</span>
              <h3>{categoryLabel(slug)}</h3>
              <p>{categoryDescription(slug)}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="section-block" aria-labelledby="gate-heading">
        <SectionHeading
          id="gate-heading"
          eyebrow="Release truth"
          title="Read-only until the rails prove themselves."
          description="Optional capabilities stay independently disabled while the public marketplace remains useful."
        />
        <div className="gate-grid">
          <div className="gate-card">
            <div className="gate-card__top"><h3>Core Marketplace</h3><StatusBadge value="enabled" tone="success" /></div>
            <p>Browse, search, filters, detail, comparison, identity, six state axes, and truthful next actions.</p>
          </div>
          <div className="gate-card">
            <div className="gate-card__top"><h3>Activation + Commerce</h3><span className="gate-card__status">disabled</span></div>
            <p>ERC-8183 and X402/B402 remain unavailable while lock addresses, recipients, assets, and canaries are unresolved.</p>
          </div>
          <div className="gate-card">
            <div className="gate-card__top"><h3>Creator + Altana</h3><span className="gate-card__status">disabled</span></div>
            <p>Creator stays out of this W0/W1 critical path until the browser-to-Studio custody spike is accepted.</p>
          </div>
        </div>
      </section>

      <section className="section-block">
        <Callout title="Development data is labelled" tone="info" icon="i">
          The web surface consumes the shared @bnbera/marketplace read contract. Development records enter only through its explicitly bounded fixture source and are visibly marked; production defaults to an empty read model until an API endpoint is configured.
        </Callout>
      </section>
    </div>
  );
}
