import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — PGX Playground X" },
      {
        name: "description",
        content:
          "How PGX Playground X collects, uses, and protects your personal information across lounges, chat, and payments.",
      },
      { property: "og:title", content: "Privacy Policy — PGX Playground X" },
      {
        property: "og:description",
        content:
          "Data collection, use, sharing, retention, and your rights on PGX Playground X.",
      },
      { name: "robots", content: "index,follow" },
    ],
  }),
  component: PrivacyPage,
});

const LAST_UPDATED = "July 5, 2026";

function PrivacyPage() {
  return (
    <AppShell>
      <article className="mx-auto w-full max-w-3xl px-4 py-12 md:px-6 md:py-16">
        <header className="mb-10 border-b border-arena-border pb-6">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-arena-border bg-arena-panel-2/60 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-arena-violet">
            Legal
          </span>
          <h1 className="mt-3 font-display text-3xl font-extrabold uppercase tracking-tight text-white md:text-4xl">
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Last updated: {LAST_UPDATED}
          </p>
        </header>

        <p className="mb-6 rounded-md border border-arena-border bg-arena-panel-2/40 p-4 text-sm text-muted-foreground">
          This page is maintained by the PGX Playground X team as a starting
          template describing the data the app collects today. Review with
          legal counsel and edit the wording, subprocessors, retention
          periods, and jurisdiction to match your business before relying on
          it in production.
        </p>

        <Section title="1. Who we are">
          <p>
            "PGX Playground X" (the "Service") is operated by the app owner.
            This policy explains what personal information we collect and how
            we use it.
          </p>
        </Section>

        <Section title="2. Information we collect">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong className="text-white">Account data:</strong> email
              address, display name, and profile avatar you upload.
            </li>
            <li>
              <strong className="text-white">Usage data:</strong> lounges you
              enter, viewing time, chat messages, reactions, and wallet
              transactions.
            </li>
            <li>
              <strong className="text-white">Device data:</strong> IP address,
              browser and device type, and approximate location, for
              security and stream quality.
            </li>
            <li>
              <strong className="text-white">Payment data:</strong> processed
              by our payment provider; we store transaction metadata but not
              full card numbers.
            </li>
          </ul>
        </Section>

        <Section title="3. How we use your information">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Provide, operate, and improve the Service.</li>
            <li>Authenticate you and secure your account.</li>
            <li>Process payments, entries, and refunds.</li>
            <li>Show live viewer counts and community activity.</li>
            <li>Communicate service updates and, with consent, marketing.</li>
            <li>Detect fraud, abuse, and violations of our Terms.</li>
          </ul>
        </Section>

        <Section title="4. Sharing & subprocessors">
          <p>
            We share personal information only with service providers who help
            us run the Service (for example, hosting, authentication,
            payments, email delivery, and analytics), under contract and only
            as needed. We do not sell your personal information.
          </p>
        </Section>

        <Section title="5. Cookies & analytics">
          <p>
            We use strictly necessary cookies for authentication and session
            management. We may use privacy-friendly analytics to understand
            aggregate usage. You can control non-essential cookies via your
            browser settings.
          </p>
        </Section>

        <Section title="6. Data retention">
          <p>
            We retain account and transaction data for as long as your account
            is active and afterwards as required for legal, tax, and dispute
            resolution purposes. You can request deletion at any time.
          </p>
        </Section>

        <Section title="7. Your rights">
          <p>
            Depending on where you live, you may have the right to access,
            correct, delete, or export your personal information, or to
            object to certain processing. Contact us using the details below
            to exercise these rights.
          </p>
        </Section>

        <Section title="8. Security">
          <p>
            We use industry-standard measures to protect your information,
            including encryption in transit, access controls, and row-level
            database security. No system is 100% secure; please use a strong,
            unique password.
          </p>
        </Section>

        <Section title="9. Children">
          <p>
            The Service is not directed to children under 18 (or the age of
            majority in your jurisdiction). We do not knowingly collect
            personal information from children.
          </p>
        </Section>

        <Section title="10. Changes to this policy">
          <p>
            We may update this policy from time to time. Material changes will
            be announced in-app or by email. The "Last updated" date at the
            top of this page reflects the most recent revision.
          </p>
        </Section>

        <Section title="11. Contact">
          <p>
            Questions or requests? Email{" "}
            <a
              href="mailto:privacy@playground-x.example"
              className="text-arena-violet underline-offset-2 hover:underline"
            >
              privacy@playground-x.example
            </a>
            .
          </p>
        </Section>

        <p className="mt-10 text-sm text-muted-foreground">
          See also our{" "}
          <Link
            to="/terms"
            className="text-arena-violet underline-offset-2 hover:underline"
          >
            Terms of Service
          </Link>
          .
        </p>
      </article>
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 font-display text-lg font-bold uppercase tracking-tight text-white">
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}
