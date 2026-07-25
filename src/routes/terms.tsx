import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — PGX Playground X" },
      {
        name: "description",
        content:
          "The Terms of Service governing your access to and use of PGX Playground X lounges, streams, and community features.",
      },
      { property: "og:title", content: "Terms of Service — PGX Playground X" },
      {
        property: "og:description",
        content: "The terms that govern use of the PGX virtual sports arena.",
      },
      { name: "robots", content: "index,follow" },
    ],
  }),
  component: TermsPage,
});

const LAST_UPDATED = "July 5, 2026";

function TermsPage() {
  return (
    <AppShell>
      <article className="mx-auto w-full max-w-3xl px-4 py-12 md:px-6 md:py-16">
        <header className="mb-10 border-b border-arena-border pb-6">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-arena-border bg-arena-panel-2/60 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-arena-violet">
            Legal
          </span>
          <h1 className="mt-3 font-display text-3xl font-extrabold uppercase tracking-tight text-white md:text-4xl">
            Terms of Service
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Last updated: {LAST_UPDATED}
          </p>
        </header>

        <p className="mb-6 rounded-md border border-arena-border bg-arena-panel-2/40 p-4 text-sm text-muted-foreground">
          This page is maintained by the PGX Playground X team as a starting
          template. Review with your legal counsel and edit the wording,
          jurisdiction, and contact details to match your business before
          relying on it in production.
        </p>

        <Section title="1. Agreement">
          <p>
            By creating an account or otherwise using PGX Playground X (the
            "Service"), you agree to these Terms of Service. If you do not
            agree, do not use the Service.
          </p>
        </Section>

        <Section title="2. Eligibility & Accounts">
          <p>
            You must be at least 18 years old (or the age of majority in your
            jurisdiction) to create an account. You are responsible for
            maintaining the confidentiality of your account credentials and
            for all activity that occurs under your account.
          </p>
        </Section>

        <Section title="3. The Service">
          <p>
            PGX provides virtual "lounges" that display third-party live sports
            broadcasts and community features such as chat and reactions. Room
            availability, feeds, and features may change without notice.
          </p>
        </Section>

        <Section title="4. Payments">
          <p>
            Some lounges and features require a one-time entry fee. Prices
            and refund eligibility are shown at checkout. Taxes may apply
            based on your location.
          </p>
        </Section>

        <Section title="5. Acceptable Use">
          <p>
            You agree not to: (a) redistribute, re-stream, or record any
            broadcast; (b) harass other users or post unlawful content in
            chat; (c) attempt to circumvent access gates or DRM; (d) use bots,
            scrapers, or automated agents without written permission.
          </p>
        </Section>

        <Section title="6. Intellectual Property">
          <p>
            All PGX branding, UI, and original content is owned by the app
            owner. Broadcast content is owned by the respective rights
            holders. You receive a limited, non-transferable, revocable
            license to view content within the Service.
          </p>
        </Section>

        <Section title="7. Termination">
          <p>
            We may suspend or terminate your access at any time for violation
            of these Terms. You may stop using the Service at any time; paid
            fees are non-refundable except where required by law.
          </p>
        </Section>

        <Section title="8. Disclaimers & Liability">
          <p>
            The Service is provided "as is" without warranties of any kind.
            To the maximum extent permitted by law, the app owner is not
            liable for indirect, incidental, or consequential damages arising
            from your use of the Service.
          </p>
        </Section>

        <Section title="9. Changes to these Terms">
          <p>
            We may update these Terms from time to time. Material changes
            will be announced in-app or by email. Continued use of the
            Service after changes take effect constitutes acceptance.
          </p>
        </Section>

        <Section title="10. Contact">
          <p>
            Questions about these Terms? Email{" "}
            <a
              href="mailto:support@playground-x.example"
              className="text-arena-violet underline-offset-2 hover:underline"
            >
              support@playground-x.example
            </a>
            .
          </p>
        </Section>

        <p className="mt-10 text-sm text-muted-foreground">
          See also our{" "}
          <Link
            to="/privacy"
            className="text-arena-violet underline-offset-2 hover:underline"
          >
            Privacy Policy
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
