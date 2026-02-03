import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { Button } from '@/components/ui/button'
import { Calendar, Clock, Users, Zap } from 'lucide-react'

export default async function Home() {
  const { userId } = await auth()
  const isLoggedIn = !!userId
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white">
              <Calendar className="h-5 w-5" />
            </div>
            <span className="text-xl font-bold">Freiplatz</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/pricing" className="text-sm font-medium text-gray-600 hover:text-gray-900">
              Pricing
            </Link>
            {isLoggedIn ? (
              <Link href="/dashboard">
                <Button>Dashboard</Button>
              </Link>
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
      <section className="mx-auto max-w-6xl px-4 py-24 text-center">
        <h1 className="text-5xl font-bold tracking-tight text-gray-900">
          Online Booking
          <br />
          <span className="text-primary">Made Simple</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-xl text-gray-600">
          Accept appointments online 24/7. Let your customers book when it's convenient
          for them, while you focus on what you do best.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
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
      </section>

      {/* Features */}
      <section className="border-t bg-white py-24">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-3xl font-bold text-gray-900">
            Everything you need to manage bookings
          </h2>
          <div className="mt-16 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Calendar className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">Online Booking</h3>
              <p className="mt-2 text-gray-600">
                Customers book appointments 24/7 from your website
              </p>
            </div>
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Clock className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">Smart Scheduling</h3>
              <p className="mt-2 text-gray-600">
                Automatic availability based on staff schedules
              </p>
            </div>
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Users className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">Multi-Staff</h3>
              <p className="mt-2 text-gray-600">
                Manage multiple service providers with ease
              </p>
            </div>
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Zap className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">Notifications</h3>
              <p className="mt-2 text-gray-600">
                Automatic reminders to reduce no-shows
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24">
        <div className="mx-auto max-w-6xl px-4 text-center">
          <h2 className="text-3xl font-bold text-gray-900">
            {isLoggedIn ? "Welcome back!" : "Ready to streamline your bookings?"}
          </h2>
          <p className="mt-4 text-xl text-gray-600">
            {isLoggedIn ? "Continue managing your bookings" : "Join thousands of businesses using Freiplatz"}
          </p>
          <Link href={isLoggedIn ? "/dashboard" : "/sign-up"} className="mt-8 inline-block">
            <Button size="lg" className="text-lg">
              {isLoggedIn ? "Go to Dashboard" : "Get Started Free"}
            </Button>
          </Link>
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
