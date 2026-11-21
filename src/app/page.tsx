import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CreditCard,
  Globe2,
  Landmark,
  LockKeyhole,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Wallet,
  Zap,
} from "lucide-react";
import { Brand } from "@/components/Brand";
import { ContactDetails } from "@/components/ContactDetails";
import { hasContact } from "@/lib/contact";
import { getContactInfo } from "@/lib/contact-server";

// Contact details come from the database (Admin → Contact details), so render per request:
// a change by the admin shows up immediately.
export const dynamic = "force-dynamic";

const features = [
  {
    icon: Zap,
    title: "Instant transfers",
    text: "Send money and watch it arrive in seconds. Domestic and international, from one account.",
    color: "from-violet-500 to-purple-700",
  },
  {
    icon: Globe2,
    title: "30+ currencies",
    text: "Hold USD, EUR, GBP and more in one wallet. Transparent rates on every exchange.",
    color: "from-cyan-400 to-blue-600",
  },
  {
    icon: CreditCard,
    title: "Virtual & physical cards",
    text: "Pay safely with single-use virtual cards and IGW cards accepted worldwide.",
    color: "from-fuchsia-500 to-violet-700",
  },
  {
    icon: ShieldCheck,
    title: "Security first",
    text: "Two-factor authentication, instant card controls and 24/7 monitoring keep your money safe.",
    color: "from-emerald-400 to-teal-600",
  },
];

const steps = [
  {
    number: "01",
    icon: Smartphone,
    title: "Create your account",
    text: "Open your IGW wallet in minutes, verify your identity and pick your currencies.",
  },
  {
    number: "02",
    icon: Wallet,
    title: "Add money and pay",
    text: "Top up with your bank card, then pay with saved cards or your account balance.",
  },
  {
    number: "03",
    icon: Landmark,
    title: "Withdraw anytime",
    text: "Move funds to your bank account or withdraw cash at an ATM with your IGW card.",
  },
];

const footerColumns = [
  { title: "Product", links: ["Wallet", "Money Transfer", "IGW Cards", "Exchange", "Fees"] },
  { title: "Company", links: ["About", "Security", "Careers", "Press", "Contact"] },
  { title: "Legal", links: ["Privacy Policy", "Terms of Use", "Cookie Policy", "Compliance"] },
];

export default async function LandingPage() {
  const contact = await getContactInfo();
  const showContact = hasContact(contact);
  return (
    <main className="overflow-hidden bg-white">
      {/* Announcement */}
      <div className="igw-gradient relative z-50 text-center text-[11px] font-medium tracking-wide text-white/95 sm:text-xs">
        <div className="mx-auto flex max-w-7xl items-center justify-center gap-2 px-4 py-2">
          <Sparkles className="h-3.5 w-3.5" />
          <span>New: 30+ currencies and instant exchange in one wallet</span>
          <Link href="/dashboard" className="ml-1 hidden font-bold underline underline-offset-4 sm:inline">
            Explore
          </Link>
        </div>
      </div>

      {/* Navbar */}
      <header className="sticky top-0 z-40 border-b border-slate-100/80 igw-glass">
        <nav className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-5 sm:px-8">
          <Brand />
          <div className="hidden items-center gap-8 text-[13px] font-semibold text-slate-600 lg:flex">
            <a className="transition hover:text-[#7F00FF]" href="#features">Features</a>
            <a className="transition hover:text-[#7F00FF]" href="#how">How it works</a>
            <a className="transition hover:text-[#7F00FF]" href="#cards">IGW Cards</a>
            <a className="transition hover:text-[#7F00FF]" href="#security">Security</a>
            {showContact && <a className="transition hover:text-[#7F00FF]" href="#contact">Contact</a>}
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="hidden text-[13px] font-semibold text-slate-700 transition hover:text-[#7F00FF] sm:block">
              Sign in
            </Link>
            <Link
              href="/signup"
              className="igw-gradient inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[12px] font-bold text-white shadow-[0_10px_24px_rgba(127,0,255,0.28)] transition hover:-translate-y-0.5 sm:px-5 sm:text-[13px]"
            >
              Open Wallet <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative">
        <div className="pointer-events-none absolute inset-0 igw-grid opacity-70" />
        <div className="animate-pulse-glow pointer-events-none absolute -left-40 top-10 h-[420px] w-[420px] rounded-full bg-purple-300/25 blur-[110px]" />
        <div className="animate-pulse-glow pointer-events-none absolute -right-20 top-32 h-[380px] w-[380px] rounded-full bg-cyan-300/30 blur-[100px]" />

        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 pb-20 pt-16 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:pb-28 lg:pt-24">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-purple-200 bg-white/80 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#7F00FF] shadow-sm">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#7F00FF] opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#7F00FF]" />
              </span>
              The world's wallet, in your pocket
            </div>

            <h1 className="mt-6 text-[clamp(2.7rem,5.6vw,5rem)] font-black leading-[1.02] tracking-[-0.055em] text-[#10152b]">
              Your money,
              <br />
              <span className="igw-text-gradient">knows no borders.</span>
            </h1>

            <p className="mt-6 max-w-xl text-[15px] leading-7 text-slate-600 sm:text-[17px]">
              Manage more than 30 currencies in one place with Insta Global Wallet.
              Send instantly, pay securely with your virtual card and take your money
              anywhere in the world.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/signup"
                className="igw-gradient group inline-flex items-center gap-2 rounded-2xl px-6 py-4 text-sm font-bold text-white shadow-[0_18px_36px_-12px_rgba(127,0,255,0.7)] transition hover:-translate-y-1"
              >
                Open free wallet
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
              </Link>
              <a
                href="#how"
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-6 py-4 text-sm font-bold text-slate-800 shadow-sm transition hover:-translate-y-1 hover:border-purple-300"
              >
                How it works
              </a>
            </div>

            <div className="mt-10 flex flex-wrap items-center gap-x-7 gap-y-4">
              <div className="flex -space-x-2.5">
                {["#7F00FF", "#19A2D3", "#F59E0B", "#10B981"].map((color, index) => (
                  <span
                    key={color}
                    className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white text-[10px] font-bold text-white"
                    style={{ background: color, zIndex: 4 - index }}
                  >
                    {["DA", "EF", "LF", "MK"][index]}
                  </span>
                ))}
              </div>
              <div>
                <div className="flex items-center gap-1 text-amber-500">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <span key={index} className="text-sm">★</span>
                  ))}
                  <span className="ml-1 text-xs font-bold text-slate-800">4.9/5</span>
                </div>
                <p className="text-[11px] text-slate-500">Trusted by users in 180+ countries</p>
              </div>
            </div>
          </div>

          {/* Hero visual */}
          <div className="relative mx-auto h-[500px] w-full max-w-[520px] sm:h-[560px]">
            <div className="absolute left-1/2 top-1/2 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full igw-gradient opacity-20 blur-[70px]" />

            {/* Phone */}
            <div className="animate-float absolute left-1/2 top-2 z-20 w-[270px] -translate-x-1/2 rounded-[38px] border-[7px] border-[#151a32] bg-[#151a32] shadow-[0_40px_90px_-25px_rgba(16,21,43,0.6)] sm:w-[290px]">
              <div className="relative overflow-hidden rounded-[30px] bg-white">
                <div className="relative h-[470px] overflow-hidden sm:h-[500px]">
                  <div className="absolute inset-x-0 top-0 h-40 igw-gradient" />
                  <div className="relative px-5 pt-3">
                    <div className="mx-auto h-5 w-24 rounded-full bg-[#151a32]" />
                    <div className="mt-5 flex items-center justify-between">
                      <div>
                        <p className="text-[9px] font-medium text-white/70">Good morning, Deniz 👋</p>
                        <p className="text-[14px] font-bold text-white">Total balance</p>
                      </div>
                      <span className="flex h-8 w-8 items-center justify-center rounded-full igw-dark-glass text-white text-[10px] font-bold">DA</span>
                    </div>
                    <p className="mt-4 text-[30px] font-black tracking-tight text-white">$14.906,74</p>
                    <p className="text-[10px] font-medium text-emerald-200">↗ %12,4 bu ay</p>
                  </div>

                  <div className="relative mx-4 -mt-3 rounded-2xl bg-white p-4 shadow-[0_16px_40px_-15px_rgba(16,21,43,0.35)]">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-bold text-slate-800">Your currencies</p>
                      <span className="text-[9px] font-semibold text-[#7F00FF]">View all</span>
                    </div>
                    <div className="mt-3 space-y-2.5">
                      {[
                        ["🇺🇸", "USD", "$8.420,50", "from-violet-500 to-purple-700"],
                        ["🇪🇺", "EUR", "€3.180,25", "from-cyan-400 to-blue-600"],
                        ["🇬🇧", "GBP", "£1.240,00", "from-amber-400 to-orange-600"],
                      ].map(([flag, code, value, gradient]) => (
                        <div key={code} className="flex items-center gap-2.5">
                          <span className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${gradient} text-sm`}>{flag}</span>
                          <span className="text-[10px] font-bold text-slate-700">{code}</span>
                          <div className="ml-auto h-1.5 w-14 overflow-hidden rounded-full bg-slate-100">
                            <div className={`h-full rounded-full bg-gradient-to-r ${gradient}`} style={{ width: code === "USD" ? "85%" : code === "EUR" ? "62%" : "40%" }} />
                          </div>
                          <span className="text-[10px] font-bold text-slate-800">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="relative mt-5 px-5">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-bold text-slate-800">Recent activity</p>
                      <span className="text-[9px] text-slate-400">Today</span>
                    </div>
                    <div className="mt-3 space-y-3">
                      {[
                        { icon: ArrowDownLeft, name: "Nova Studio", amount: "+$1.250,00", bg: "bg-emerald-50 text-emerald-600" },
                        { icon: ArrowUpRight, name: "Elif Yilmaz", amount: "−$250,00", bg: "bg-purple-50 text-[#7F00FF]" },
                        { icon: CreditCard, name: "Spotify", amount: "−€42,90", bg: "bg-cyan-50 text-cyan-600" },
                      ].map((item) => (
                        <div key={item.name} className="flex items-center gap-2.5">
                          <span className={`flex h-8 w-8 items-center justify-center rounded-full ${item.bg}`}>
                            <item.icon className="h-3.5 w-3.5" />
                          </span>
                          <span className="text-[10px] font-semibold text-slate-700">{item.name}</span>
                          <span className="ml-auto text-[10px] font-bold text-slate-900">{item.amount}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Floating bank card */}
            <div className="animate-float-slow absolute bottom-2 right-0 z-30 w-[280px] rotate-[-8deg] rounded-2xl igw-gradient p-5 text-white shadow-[0_30px_60px_-20px_rgba(89,0,179,0.7)] sm:w-[320px]">
              <div className="igw-card-shine relative">
                <div className="flex items-start justify-between">
                  <span className="text-sm font-black tracking-tight">instaglobalwallet</span>
                  <span className="text-[10px] font-bold opacity-80">VISA</span>
                </div>
                <div className="mt-10 flex items-center gap-2">
                  <span className="h-6 w-8 rounded-full bg-yellow-300/90" />
                  <span className="-ml-4 h-6 w-8 rounded-full bg-white/70" />
                </div>
                <p className="mt-5 font-mono text-[15px] tracking-[0.18em]">•••• •••• •••• 4291</p>
                <div className="mt-3 flex justify-between text-[9px] font-semibold uppercase tracking-widest opacity-80">
                  <span>Deniz Arslan</span><span>09/29</span>
                </div>
              </div>
            </div>

            {/* Floating badges */}
            <div className="animate-float absolute left-0 top-28 z-30 flex items-center gap-2 rounded-2xl border border-white/70 bg-white/90 px-3.5 py-2.5 shadow-lg backdrop-blur sm:left-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><Zap className="h-4 w-4" /></span>
              <div>
                <p className="text-[10px] font-bold text-slate-900">Instant transfers</p>
                <p className="text-[9px] text-slate-500">Completed in 3 seconds</p>
              </div>
            </div>

            <div className="animate-float-slow absolute bottom-36 left-0 z-30 flex items-center gap-2 rounded-2xl border border-white/70 bg-white/90 px-3.5 py-2.5 shadow-lg backdrop-blur sm:-left-4">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-50 text-[#7F00FF]"><LockKeyhole className="h-4 w-4" /></span>
              <div>
                <p className="text-[10px] font-bold text-slate-900">256-bit security</p>
                <p className="text-[9px] text-slate-500">Every transaction protected</p>
              </div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="relative border-y border-slate-100 bg-white/70">
          <div className="mx-auto grid max-w-7xl grid-cols-2 gap-y-8 px-5 py-9 sm:px-8 lg:grid-cols-4">
            {[
              ["30+", "para birimi"],
              ["180+", "countries supported"],
              ["24/7", "live support"],
              ["%0", "hidden fees"],
            ].map(([value, label], index) => (
              <div key={label} className={`text-center lg:text-left ${index > 0 ? "lg:pl-12" : ""}`}>
                <p className="igw-text-gradient text-3xl font-black tracking-tight">{value}</p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-7xl px-5 py-24 sm:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[#7F00FF]">Why IGW?</p>
          <h2 className="mt-4 text-[clamp(2rem,4vw,3.2rem)] font-black leading-tight tracking-tight text-[#10152b]">
            Your financial life, <span className="igw-text-gradient">all in one place.</span>
          </h2>
          <p className="mt-4 text-[15px] leading-7 text-slate-600">
            Insta Global Wallet simplifies how you pay. Manage your accounts,
            cards and transfers from one smart dashboard.
          </p>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <article
              key={feature.title}
              className="group relative overflow-hidden rounded-[26px] border border-slate-100 bg-white p-6 shadow-[0_12px_40px_-24px_rgba(16,21,43,0.35)] transition duration-300 hover:-translate-y-1.5 hover:border-purple-200 hover:shadow-[0_28px_60px_-30px_rgba(127,0,255,0.45)]"
            >
              <div className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${feature.color} text-white shadow-lg`}>
                <feature.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-6 text-lg font-extrabold tracking-tight text-[#10152b]">{feature.title}</h3>
              <p className="mt-3 text-[13px] leading-6 text-slate-600">{feature.text}</p>
              <div className="mt-6 flex items-center gap-1 text-xs font-bold text-[#7F00FF]">
                Daha fazla <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-1" />
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="relative overflow-hidden bg-[#10152b] py-24 text-white">
        <div className="pointer-events-none absolute -left-32 top-0 h-[500px] w-[500px] rounded-full bg-[#7F00FF]/30 blur-[120px]" />
        <div className="pointer-events-none absolute -right-32 bottom-0 h-[420px] w-[420px] rounded-full bg-[#19A2D3]/25 blur-[120px]" />
        <div className="relative mx-auto grid max-w-7xl gap-14 px-5 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-300">How it works</p>
            <h2 className="mt-4 text-[clamp(2rem,4vw,3.2rem)] font-black leading-tight tracking-tight">
              Go global in <span className="igw-text-gradient">three simple steps.</span>
            </h2>
            <p className="mt-5 max-w-md text-[15px] leading-7 text-white/65">
              Our team is with you at every step so using the app feels effortless.
              Set up your wallet, make payments and withdraw whenever you want.
            </p>
            <Link href="/signup" className="mt-8 inline-flex items-center gap-2 rounded-full igw-gradient px-6 py-3.5 text-sm font-bold shadow-[0_14px_32px_-12px_rgba(127,0,255,0.9)]">
              Get started <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {steps.map((step) => (
              <div key={step.number} className="igw-dark-glass rounded-[26px] p-6 transition hover:bg-white/[0.13]">
                <div className="flex items-center justify-between">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl igw-gradient text-white">
                    <step.icon className="h-5 w-5" />
                  </span>
                  <span className="text-3xl font-black text-white/10">{step.number}</span>
                </div>
                <h3 className="mt-7 text-lg font-extrabold">{step.title}</h3>
                <p className="mt-3 text-[13px] leading-6 text-white/60">{step.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Cards */}
      <section id="cards" className="mx-auto max-w-7xl px-5 py-24 sm:px-8">
        <div className="grid items-center gap-16 lg:grid-cols-2">
          <div className="relative order-2 h-[420px] lg:order-1">
            <div className="animate-float-slow absolute left-0 top-6 w-[300px] rounded-[24px] igw-gradient p-6 text-white shadow-[0_35px_70px_-30px_rgba(127,0,255,0.8)] sm:w-[340px]">
              <div className="igw-card-shine relative">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70">Insta Global Wallet</p>
                    <p className="mt-1 text-lg font-black">Virtual Card</p>
                  </div>
                  <span className="text-sm font-black italic">VISA</span>
                </div>
                <p className="mt-12 font-mono text-lg tracking-[0.2em]">4821 •••• •••• 4291</p>
                <div className="mt-6 flex justify-between text-[10px] uppercase tracking-widest text-white/70">
                  <span>Deniz Arslan</span><span>09/29</span>
                </div>
              </div>
            </div>
            <div className="animate-float absolute bottom-0 right-0 w-[280px] rounded-[24px] bg-[#151a32] p-6 text-white shadow-[0_35px_70px_-30px_rgba(16,21,43,0.8)] sm:w-[320px]">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">Insta Global Wallet</p>
                  <p className="mt-1 text-lg font-black">Metal Card</p>
                </div>
                <span className="text-sm font-black">●●</span>
              </div>
              <p className="mt-12 font-mono text-lg tracking-[0.2em]">•••• •••• •••• 8803</p>
              <div className="mt-6 flex justify-between text-[10px] uppercase tracking-widest text-white/50">
                <span>Deniz Arslan</span><span>04/28</span>
              </div>
            </div>
          </div>

          <div className="order-1 lg:order-2">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[#7F00FF]">IGW Cards</p>
            <h2 className="mt-4 text-[clamp(2rem,4vw,3.2rem)] font-black leading-tight tracking-tight text-[#10152b]">
              Your card, your <span className="igw-text-gradient">rules.</span>
            </h2>
            <p className="mt-5 text-[15px] leading-7 text-slate-600">
              Accepted at millions of shops and ATMs around the world, IGW cards make
              payments fast, flexible and secure.
            </p>
            <div className="mt-8 space-y-4">
              {[
                ["Instant", "Create a single-use virtual card from your account and use it right away."],
                ["Worldwide", "Pay anywhere with your USD, EUR and GBP balances."],
                ["Full control", "Freeze your card, manage limits and see activity instantly."],
              ].map(([title, text]) => (
                <div key={title} className="flex gap-4 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-[#7F00FF] shadow-sm"><Check className="h-4 w-4" /></span>
                  <div>
                    <p className="text-sm font-extrabold text-[#10152b]">{title}</p>
                    <p className="mt-1 text-[13px] leading-6 text-slate-600">{text}</p>
                  </div>
                </div>
              ))}
            </div>
            <Link href="/dashboard#cards" className="mt-8 inline-flex items-center gap-2 text-sm font-bold text-[#7F00FF]">
              Manage my cards <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Security */}
      <section id="security" className="px-5 pb-24 sm:px-8">
        <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[36px] igw-gradient px-8 py-14 text-white sm:px-14">
          <div className="pointer-events-none absolute -right-16 -top-20 h-72 w-72 rounded-full bg-white/15 blur-3xl" />
          <div className="relative grid gap-10 lg:grid-cols-[1fr_0.9fr] lg:items-center">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest">
                <ShieldCheck className="h-3.5 w-3.5" /> Security merkezi
              </span>
              <h2 className="mt-5 text-[clamp(1.9rem,3.6vw,3rem)] font-black leading-tight tracking-tight">
                The strongest <span className="text-white/80">protection for your money.</span>
              </h2>
              <p className="mt-4 max-w-lg text-[15px] leading-7 text-white/80">
                Advanced encryption, real-time monitoring and two-step verification keep
                every transaction safe. Licensed under IGW Financial Services Commission.
              </p>
              <Link href="/signup" className="mt-7 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3.5 text-sm font-bold text-[#7F00FF] transition hover:-translate-y-1">
                Open secure wallet <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                [LockKeyhole, "256-bit SSL"],
                [ShieldCheck, "2FA koruma"],
                [Globe2, "Global uyum"],
                [Zap, "Instant alerts"],
              ].map(([Icon, label]) => {
                const ItemIcon = Icon as typeof LockKeyhole;
                return (
                  <div key={label as string} className="igw-dark-glass rounded-2xl p-5">
                    <ItemIcon className="h-5 w-5" />
                    <p className="mt-4 text-sm font-bold">{label as string}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-5 pb-24 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-8 rounded-[36px] border border-slate-100 bg-white px-8 py-14 text-center igw-shadow-soft lg:flex-row lg:text-left">
          <div>
            <h2 className="text-[clamp(1.9rem,3.4vw,2.8rem)] font-black tracking-tight text-[#10152b]">
              The world's money, <span className="igw-text-gradient">in your wallet.</span>
            </h2>
            <p className="mt-3 max-w-xl text-[15px] text-slate-600">
              Create your account in minutes, make your first transfer and discover IGW benefits.
            </p>
          </div>
          <Link href="/dashboard" className="group inline-flex shrink-0 items-center gap-2 rounded-2xl igw-gradient px-7 py-4 text-sm font-bold text-white shadow-[0_18px_36px_-12px_rgba(127,0,255,0.7)] transition hover:-translate-y-1">
            Go to my wallet <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
          </Link>
        </div>
      </section>

      {/* Contact (details are set by the admin: Admin → Contact details) */}
      {showContact && (
        <section id="contact" className="scroll-mt-24 px-5 pb-24 sm:px-8" data-testid="contact-section">
          <div className="mx-auto max-w-7xl">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[#7F00FF]">Contact</p>
            <h2 className="mt-3 text-[clamp(1.8rem,3.2vw,2.6rem)] font-black tracking-tight text-[#10152b]">
              Get in <span className="igw-text-gradient">touch.</span>
            </h2>
            <p className="mt-3 max-w-xl text-[15px] text-slate-600">Questions about your account, deposits or withdrawals? Reach our team here.</p>
            <div className="mt-8">
              <ContactDetails contact={contact} />
            </div>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-100 bg-[#fafafe]">
        <div className="mx-auto max-w-7xl px-5 py-14 sm:px-8">
          <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div>
              <Brand />
              <p className="mt-5 max-w-xs text-[13px] leading-6 text-slate-500">
                Insta Global Wallet is a smart digital wallet that helps you manage your money
                anywhere in the world.
              </p>
              <div className="mt-5 flex gap-2">
                {["IG", "X", "in", "f"].map((label) => (
                  <span key={label} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-[10px] font-bold text-slate-500">{label}</span>
                ))}
              </div>
            </div>
            {footerColumns.map((column) => (
              <div key={column.title}>
                <p className="text-xs font-black uppercase tracking-wider text-[#10152b]">{column.title}</p>
                <ul className="mt-4 space-y-2.5">
                  {column.links.map((link) => (
                    <li key={link}>
                      <a href={link === "Contact" && showContact ? "#contact" : "#features"} className="text-[13px] text-slate-500 transition hover:text-[#7F00FF]">{link}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-12 flex flex-col justify-between gap-3 border-t border-slate-200 pt-6 text-[11px] text-slate-400 sm:flex-row">
            <p>© {new Date().getFullYear()} Insta Global Wallet. All rights reserved.</p>
            <p>Demo interface · instaglobalwallet.com</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
