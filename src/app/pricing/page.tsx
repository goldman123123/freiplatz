import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { SignOutButton } from '@clerk/nextjs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Calendar, Check, LogOut } from 'lucide-react'

const tiers = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'Perfect for trying out Freiplatz',
    features: [
      '1 staff member',
      '50 bookings/month',
      'Email confirmations',
      'Basic booking page',
      'freiplatz.io/book/slug URL',
    ],
    limitations: [
      'Freiplatz branding',
    ],
    cta: 'Get Started',
    ctaVariant: 'outline' as const,
    popular: false,
  },
  {
    name: 'Starter',
    price: '$19',
    period: '/month',
    description: 'For small businesses getting started',
    features: [
      'Up to 3 staff members',
      'Unlimited bookings',
      'Email + SMS reminders',
      'Remove Freiplatz branding',
      'Custom colors & logo',
      'Customer management',
      'Basic analytics',
    ],
    limitations: [],
    cta: 'Start Free Trial',
    ctaVariant: 'outline' as const,
    popular: false,
  },
  {
    name: 'Professional',
    price: '$49',
    period: '/month',
    description: 'For growing businesses that need more',
    features: [
      'Unlimited staff members',
      'Everything in Starter, plus:',
      'Google Calendar sync',
      'Custom domain (book.yourbiz.com)',
      'Send emails from your domain',
      'Stripe payments & deposits',
      'Waitlist management',
      'API access',
      'Priority support',
    ],
    limitations: [],
    cta: 'Start Free Trial',
    ctaVariant: 'default' as const,
    popular: true,
  },
  {
    name: 'Business',
    price: '$99',
    period: '/month',
    description: 'For multi-location businesses',
    features: [
      'Everything in Professional, plus:',
      'Multiple locations',
      'Team management & roles',
      'Advanced analytics & reports',
      'Webhooks & integrations',
      'Dedicated account manager',
      'Custom onboarding',
      'SLA guarantee',
    ],
    limitations: [],
    cta: 'Contact Sales',
    ctaVariant: 'outline' as const,
    popular: false,
  },
]

const comparisonFeatures = [
  { name: 'Staff members', free: '1', starter: '3', professional: 'Unlimited', business: 'Unlimited' },
  { name: 'Bookings/month', free: '50', starter: 'Unlimited', professional: 'Unlimited', business: 'Unlimited' },
  { name: 'Email confirmations', free: true, starter: true, professional: true, business: true },
  { name: 'SMS reminders', free: false, starter: true, professional: true, business: true },
  { name: 'Remove branding', free: false, starter: true, professional: true, business: true },
  { name: 'Custom colors & logo', free: false, starter: true, professional: true, business: true },
  { name: 'Google Calendar sync', free: false, starter: false, professional: true, business: true },
  { name: 'Custom domain', free: false, starter: false, professional: true, business: true },
  { name: 'White-label email', free: false, starter: false, professional: true, business: true },
  { name: 'Stripe payments', free: false, starter: false, professional: true, business: true },
  { name: 'Waitlist', free: false, starter: false, professional: true, business: true },
  { name: 'API access', free: false, starter: false, professional: true, business: true },
  { name: 'Multiple locations', free: false, starter: false, professional: false, business: true },
  { name: 'Team roles', free: false, starter: false, professional: false, business: true },
  { name: 'Webhooks', free: false, starter: false, professional: false, business: true },
  { name: 'Priority support', free: false, starter: false, professional: true, business: true },
  { name: 'Dedicated manager', free: false, starter: false, professional: false, business: true },
]

export default async function PricingPage() {
  const { userId } = await auth()
  const isLoggedIn = !!userId

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white">
              <Calendar className="h-5 w-5" />
            </div>
            <span className="text-xl font-bold">Freiplatz</span>
          </Link>
          <div className="flex items-center gap-4">
            {isLoggedIn ? (
              <>
                <Link href="/dashboard">
                  <Button>Dashboard</Button>
                </Link>
                <SignOutButton>
                  <Button variant="ghost" size="sm">
                    <LogOut className="h-4 w-4 mr-2" />
                    Sign Out
                  </Button>
                </SignOutButton>
              </>
            ) : (
              <>
                <Link href="/sign-in">
                  <Button variant="ghost">Sign In</Button>
                </Link>
                <Link href="/sign-up">
                  <Button>Get Started</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 py-16 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
          Simple, transparent pricing
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-xl text-gray-600">
          Start free and scale as you grow. No hidden fees, no surprises.
        </p>
      </section>

      {/* Pricing Cards */}
      <section className="mx-auto max-w-6xl px-4 pb-16">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {tiers.map((tier) => (
            <Card
              key={tier.name}
              className={`relative flex flex-col ${tier.popular ? 'border-primary border-2 shadow-lg' : ''}`}
            >
              {tier.popular && (
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
                  Most Popular
                </Badge>
              )}
              <CardHeader className="text-center">
                <h3 className="text-lg font-semibold">{tier.name}</h3>
                <div className="mt-2">
                  <span className="text-4xl font-bold">{tier.price}</span>
                  <span className="text-gray-500">{tier.period}</span>
                </div>
                <p className="mt-2 text-sm text-gray-600">{tier.description}</p>
              </CardHeader>
              <CardContent className="flex-1">
                <ul className="space-y-3">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <Check className="h-5 w-5 shrink-0 text-green-500" />
                      <span className="text-sm">{feature}</span>
                    </li>
                  ))}
                  {tier.limitations.map((limitation) => (
                    <li key={limitation} className="flex items-start gap-2 text-gray-400">
                      <span className="h-5 w-5 shrink-0 text-center">-</span>
                      <span className="text-sm">{limitation}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <Link href={isLoggedIn ? "/dashboard" : "/sign-up"} className="w-full">
                  <Button variant={tier.ctaVariant} className="w-full">
                    {isLoggedIn ? "Go to Dashboard" : tier.cta}
                  </Button>
                </Link>
              </CardFooter>
            </Card>
          ))}
        </div>
      </section>

      {/* Feature Comparison Table */}
      <section className="border-t bg-white py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-3xl font-bold text-gray-900">
            Compare plans
          </h2>
          <p className="mt-2 text-center text-gray-600">
            See which plan is right for your business
          </p>

          <div className="mt-12 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="py-4 text-left font-semibold">Feature</th>
                  <th className="py-4 text-center font-semibold">Free</th>
                  <th className="py-4 text-center font-semibold">Starter</th>
                  <th className="py-4 text-center font-semibold text-primary">Professional</th>
                  <th className="py-4 text-center font-semibold">Business</th>
                </tr>
              </thead>
              <tbody>
                {comparisonFeatures.map((feature) => (
                  <tr key={feature.name} className="border-b">
                    <td className="py-4 text-sm">{feature.name}</td>
                    <td className="py-4 text-center text-sm">
                      {typeof feature.free === 'boolean' ? (
                        feature.free ? <Check className="mx-auto h-5 w-5 text-green-500" /> : <span className="text-gray-300">—</span>
                      ) : (
                        feature.free
                      )}
                    </td>
                    <td className="py-4 text-center text-sm">
                      {typeof feature.starter === 'boolean' ? (
                        feature.starter ? <Check className="mx-auto h-5 w-5 text-green-500" /> : <span className="text-gray-300">—</span>
                      ) : (
                        feature.starter
                      )}
                    </td>
                    <td className="py-4 text-center text-sm bg-primary/5">
                      {typeof feature.professional === 'boolean' ? (
                        feature.professional ? <Check className="mx-auto h-5 w-5 text-green-500" /> : <span className="text-gray-300">—</span>
                      ) : (
                        feature.professional
                      )}
                    </td>
                    <td className="py-4 text-center text-sm">
                      {typeof feature.business === 'boolean' ? (
                        feature.business ? <Check className="mx-auto h-5 w-5 text-green-500" /> : <span className="text-gray-300">—</span>
                      ) : (
                        feature.business
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16">
        <div className="mx-auto max-w-3xl px-4">
          <h2 className="text-center text-3xl font-bold text-gray-900">
            Frequently asked questions
          </h2>
          <div className="mt-12 space-y-8">
            <div>
              <h3 className="font-semibold">Can I switch plans anytime?</h3>
              <p className="mt-2 text-gray-600">
                Yes! You can upgrade or downgrade your plan at any time. When upgrading, you'll get immediate access to new features. When downgrading, changes take effect at your next billing cycle.
              </p>
            </div>
            <div>
              <h3 className="font-semibold">Is there a free trial?</h3>
              <p className="mt-2 text-gray-600">
                All paid plans come with a 14-day free trial. No credit card required to start. You can also use the Free plan indefinitely with limited features.
              </p>
            </div>
            <div>
              <h3 className="font-semibold">What payment methods do you accept?</h3>
              <p className="mt-2 text-gray-600">
                We accept all major credit cards (Visa, Mastercard, American Express) through Stripe. Annual plans can also be paid via invoice.
              </p>
            </div>
            <div>
              <h3 className="font-semibold">Do you offer discounts for annual billing?</h3>
              <p className="mt-2 text-gray-600">
                Yes! Save 20% when you choose annual billing. That's 2 months free compared to monthly billing.
              </p>
            </div>
            <div>
              <h3 className="font-semibold">What happens if I exceed my limits?</h3>
              <p className="mt-2 text-gray-600">
                On the Free plan, you won't be able to accept new bookings once you hit 50/month. We'll notify you when you're approaching your limit so you can upgrade if needed.
              </p>
            </div>
            <div>
              <h3 className="font-semibold">Can I cancel anytime?</h3>
              <p className="mt-2 text-gray-600">
                Absolutely. No contracts, no cancellation fees. You can cancel your subscription at any time and continue using the service until the end of your billing period.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t bg-primary/5 py-16">
        <div className="mx-auto max-w-6xl px-4 text-center">
          <h2 className="text-3xl font-bold text-gray-900">
            {isLoggedIn ? "Upgrade your plan" : "Ready to get started?"}
          </h2>
          <p className="mt-4 text-xl text-gray-600">
            {isLoggedIn ? "Choose a plan that fits your business needs" : "Join thousands of businesses using Freiplatz to manage their bookings"}
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link href={isLoggedIn ? "/dashboard" : "/sign-up"}>
              <Button size="lg" className="text-lg">
                {isLoggedIn ? "Go to Dashboard" : "Start Free Trial"}
              </Button>
            </Link>
            <Link href="/book/physioplus">
              <Button size="lg" variant="outline" className="text-lg">
                See Demo
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="mx-auto max-w-6xl px-4 text-center text-sm text-gray-500">
          &copy; {new Date().getFullYear()} Freiplatz. All rights reserved.
        </div>
      </footer>
    </div>
  )
}
