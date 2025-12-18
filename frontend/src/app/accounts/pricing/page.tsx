"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Check, X, Zap, Building, Users, Briefcase, ChevronDown, HelpCircle } from "lucide-react"
import { keyframes } from "@emotion/react"
import styled from "@emotion/styled"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import GradientFlow from "@/components/ui/extra-animated-base-components/gradient-flow"
import GlowingCard from "@/components/ui/extra-animated-base-components/glowing-card"
import TextWriter from "@/components/ui/extra-animated-base-components/text-writer"
import FadeIn from "@/components/ui/extra-animated-base-components/fade-in"

const float = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
`

const FloatingSparkle = styled.div`
  animation: ${float} 4s ease-in-out infinite;
  opacity: 1;
  font-size: 1.5rem;
`

const tiers = [
  { 
    name: "Public",
    description: "For public-interest users",
    subDescription: {
      who: "Public-interest users—such as citizens, students, NGOs, journalists, and researchers",
      access: "Free access to the official hosted instance",
      requirements: "Must bring your own AI (LLM) and/or search provider API keys for AI features",
      providers: "Compatible with OpenAI, Anthropic, or Perplexity"
    },
    price: "Free",
    icon: Users,
    features: [
      { name: "Full acess to our hosted webapp, data and tools", included: true },
      { name: "Community-based support channels", included: true },
    ],
    apiKeys: "Bring your own AI/LLM API keys",
    cta: "Get Started",
  },
  {
    name: "Guardians",
    description: "Public-interest organizations, NGOs, and philanthropic projects",
    subDescription: {
      who: "Free access, discounts on all managed services",
      features: [
        "Custom training and onboarding",
        "Priority technical and research support",
        "Optional infrastructure/hosting assistance"
      ],
      benefits: "Makes it easier to secure external funding and simplifies technical setup",
      pricing: "Strongly discounted enterprise services, contact us for details"
    },
    price: "Custom",
    icon: Users,
    features: [
      { name: "Access to our hosted webapp, data and tools", included: true },
      { name: "Priority support", included: true },
      { name: "Custom training & onboarding", included: true },
      { name: "Infrastructure support (optional)", included: true },
      { name: "Enhanced security features", included: true}
    ],
    apiKeys: "Bring your own AI/LLM API keys or talk to us about our managed options",
    cta: "Contact Us",
  },
  {
    name: "Commerce",
    description: "For members of commercially active/ non-public-interest organizations",
    subDescription: {
      who: "",
      contribution: "Voluntary €20/user/month contribution to support the project",
      policy: "Based on goodwill - not strictly enforced",
      principle: "Those who benefit commercially help sustain the tools"
    },
    price: "€20",
    period: "/user/month",
    annualPrice: "€200",
    icon: Briefcase,
    features: [
      { name: "Access to our hosted webapp, data and tools", included: true },
      { name: "Basic email support", included: true },
      { name: "Right to self-host under AGPLv3", included: true },
      { name: "Priority support", included: false },
      { name: "Enhanced security features", included: false },
    ],
    apiKeys: "Bring your own AI/LLM API keys",
    cta: "Start Trial",
  },
  {
    name: "Enterprise",
    description: "For large corporations and institutions",
    subDescription: {
      who: "",
      features: [
        "Priority support with SLA guarantees",
        "Optional Enterprise Self-Hosting License",
        "Managed compute & hosting solutions",
        "Enhanced security and compliance features"
      ],
      hosting: "Flexible deployment options including self-hosted or managed infrastructure",
      support: "Dedicated technical support and account management"
    },
    price: "Custom",
    icon: Building,
    features: [
      { name: "Access to our hosted webapp, data and tools", included: true },
      { name: "Priority support (SLA-based)", included: true },
      { name: "Enterprise Self-Hosting License", included: true },
      { name: "Managed compute & hosting solutions", included: true },
      { name: "Enhanced security features", included: true },
    ],
    apiKeys: "AI/LLM API keys managed by us (Optional), self-hosted or BYOC (bring your own compute)",
    cta: "Contact Us",
  },
]

const FeatureItem = ({ name, included }: { name: string; included: boolean }) => (
  <div className="flex items-center space-x-2">
    {included ? (
      <Check className="h-5 w-5 text-green-500 flex-shrink-0" />
    ) : (
      <X className="h-5 w-5 text-gray-300 flex-shrink-0" />
    )}
    <span className={included ? "" : ""}>{name}</span>
  </div>
)

const ApiKeySection = ({ apiKeys }: { apiKeys: string }) => (
  <div className="flex items-center space-x-2 text-sm">
    <Zap className="h-4 w-4 text-yellow-500" />
    <span>{apiKeys}</span>
  </div>
)

const faqData = [
  {
    question: "Is the software open-source?",
    answer:
      "Yes! The entire stack (Opol + Open Politics Webapp) is released under AGPLv3, ensuring it remains open-source and free to self-host.",
  },
  {
    question: "Can I use the hosted Webapp for free?",
    answer:
      "Public-interest users—such as citizens, students, NGOs, journalists, and researchers—are welcome to use the official hosted instance at no cost. The only extra requirement is to bring your own AI (LLM) and/or search provider API keys (e.g., OpenAI, Anthropic, or Perplexity) if you want to use AI-powered features.",
  },
  {
    question: "What about commercial users?",
    answer:
      "Commercially active organizations (e.g., agencies, private think tanks, consulting firms) are encouraged (but not strictly required) to pay a voluntary €20/user/month contribution to support the project. We do not enforce this; we rely on goodwill and the principle that those who benefit commercially from these tools help sustain them.",
  },
  {
    question: "Can I self-host?",
    answer:
      "Yes! You are free to self-host Opol and the Open Politics Webapp under AGPLv3. There is no charge for self-hosting.",
  },
  {
    question: "What is the Enterprise Self-Hosting License?",
    answer:
      "This is an optional, paid license that allows large organizations to temporarily keep modifications to Opol or the Open Politics Webapp private for internal use only. Once the subscription ends, all modifications revert to AGPLv3, meaning any subsequent public deployment of those modifications requires open sourcing them.",
  },
]

const FAQSection = () => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  return (
    <div className="max-w-4xl mx-auto mt-32 px-4">
      <motion.h2
        className="text-4xl font-bold mb-12 text-center"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        Frequently Asked Questions
      </motion.h2>
      <div className="space-y-6">
        {faqData.map((item, index) => (
          <motion.div
            key={index}
            className="rounded-lg shadow-lg overflow-hidden"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: index * 0.1 }}
          >
            <button
              className="w-full p-6 text-left focus:outline-none"
              onClick={() => setActiveIndex(activeIndex === index ? null : index)}
            >
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-semibold">{item.question}</h3>
                <ChevronDown
                  className={`w-5 h-5 text-purple-500 transform transition-transform duration-300 ${
                    activeIndex === index ? "rotate-180" : ""
                  }`}
                />
              </div>
            </button>
            <AnimatePresence>
              {activeIndex === index && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="p-6 pt-0">
                    <p>{item.answer}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ))}
      </div>
      <motion.div
        className="mt-12 text-center"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.5 }}
      >
        <p className="mb-4">Still have questions?</p>
        <Button
          variant="outline"
          size="lg"
          className=""
        >
          Contact Support at engage@open-politics.org
        </Button>
      </motion.div>
    </div>
  )
}

export default function PricingPage() {
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "annually">("monthly")

  const getCommerceTier = () => {
    const baseTier = tiers[2];
    return {
      ...baseTier,
      price: billingPeriod === "monthly" ? "€20" : "€200",
      period: billingPeriod === "monthly" ? "/user/month" : "/user/year",
    };
  };

  return (
    <section className="py-20">
      <div className="container mx-auto">
        <motion.div
          className="max-w-2xl mx-auto mb-16 text-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: .2 }}
        >
          <h1 className="text-5xl font-bold mb-6">
            <TextWriter
              text="✱"
              className="animate-shimmer mr-2"
              typingDelay={50}
              startDelay={200}
              cursorColor="currentColor"
            />
            <TextWriter
              text="fair access"
              className=""
              typingDelay={50}
              startDelay={200}
              cursorColor="currentColor"
            />
          </h1>
          <div className="text-xl">
            <p>Choose the plan that's right for you and start leveraging the power of</p>
            <FadeIn delay={0.4}>
              <h2 className="mt-4">Open Source Political Intelligence.</h2>
            </FadeIn>
          </div>
        </motion.div>
        <Tabs defaultValue="monthly" className="w-full max-w-5xl mx-auto mb-12">
          <TabsList className="grid w-full grid-cols-2 max-w-md mx-auto">
            <TabsTrigger value="monthly" onClick={() => setBillingPeriod("monthly")}>
              Monthly
            </TabsTrigger>
            <TabsTrigger value="annually" onClick={() => setBillingPeriod("annually")}>
              Annually
            </TabsTrigger>
          </TabsList>
        </Tabs>
        
        {/* Webapp Usage Tiers */}
        <div className="container mx-auto px-4 py-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto mb-16">
            {[tiers[0], getCommerceTier()].map((tier, index) => (
              <motion.div
                key={tier.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
              >
                {index === 0 ? (
                  <div className="relative h-full">
                    <div className="absolute inset-0 -z-10 rounded-md overflow-hidden">
                      <GradientFlow
                        duration={20}
                        colors={['#B8F0F7', '#C5F7C4', '#FEF5D0']}
                        fullWidth
                        radialOverlay
                        blurAmount="20px"
                      >
                        <div className="w-full h-full after:content-[''] after:absolute after:inset-0 after:bg-[url('/noise.png')] after:opacity-10 after:mix-blend-overlay" />
                      </GradientFlow>
                    </div>
                    <div className="absolute -inset-4 pointer-events-none z-10">
                      <FloatingSparkle className="absolute top-0 left-4" style={{ animationDelay: '0s' }}>✨</FloatingSparkle>
                      <FloatingSparkle className="absolute top-1/4 right-2" style={{ animationDelay: '0.3s' }}>✨</FloatingSparkle>
                      <FloatingSparkle className="absolute bottom-0 left-1/4" style={{ animationDelay: '0.1s' }}>✨</FloatingSparkle>
                    </div>
                    <GlowingCard
                      background="linear-gradient(135deg, #B8F0F7, #C5F7C4, #FEF5D0)"
                      darkBackground="linear-gradient(135deg, rgba(184, 240, 247, 0.1), rgba(197, 247, 196, 0.1), rgba(254, 245, 208, 0.1))"
                      glowIntensity={0.1}
                      glowSize={60}
                      glowColor="184, 240, 247"
                    >
                      <Card className="h-full">
                        <div className="flex flex-col h-full">
                          <CardHeader>
                            <div className="flex items-center justify-between mb-4">
                              <CardTitle className="text-2xl font-bold">{tier.name}</CardTitle>
                              <tier.icon className="h-8 w-8 text-purple-500" />
                            </div>
                            <CardDescription className="text-primary">
                              <span className="mb-2 block">{tier.description}</span>
                              <span className="text-sm text-primary opacity-80 block">{tier.subDescription.who}</span>
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="flex-grow">
                            <div className="text-3xl font-bold mb-6">
                              {tier.price}
                              {tier.period && <span className="text-base font-normal">{tier.period}</span>}
                            </div>
                            <div className="space-y-4">
                              {tier.features.map((feature) => (
                                <FeatureItem key={feature.name} {...feature} />
                              ))}
                            </div>
                          </CardContent>
                          <CardFooter className="mt-auto">
                            <div className="w-full space-y-4">
                              <ApiKeySection apiKeys={tier.apiKeys} />
                              <Button className="w-full">{tier.cta}</Button>
                            </div>
                          </CardFooter>
                        </div>
                      </Card>
                    </GlowingCard>
                  </div>
                ) : (
                  <div className="relative h-full">
                    <div className="absolute inset-0 -z-10 rounded-md overflow-hidden bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-zinc-800 dark:to-zinc-900">
                      <div className="absolute inset-0 bg-[url('/noise.png')] opacity-30 mix-blend-overlay pointer-events-none" />
                    </div>
                    <Card className="h-full transition-[border-color] duration-200 border border-zinc-200/30 dark:border-zinc-700/30 hover:border-zinc-300 dark:hover:border-zinc-600">
                      <div className="flex flex-col h-full">
                        <CardHeader>
                          <div className="flex items-center justify-between mb-4">
                            <CardTitle className="text-2xl font-bold">{tier.name}</CardTitle>
                            <tier.icon className="h-8 w-8 text-purple-500" />
                          </div>
                          <CardDescription className="text-primary">
                            <span className="mb-2 block">{tier.description}</span>
                            <span className="text-sm text-primary opacity-80 block">{tier.subDescription.who}</span>
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="flex-grow flex flex-col p-6">
                          <div>
                            <div className="text-3xl font-bold mb-6">
                              {tier.price}
                              {tier.period && <span className="text-base font-normal">{tier.period}</span>}
                            </div>
                            <CardDescription className="text-primary mb-8">
                              <span className="text-sm text-primary opacity-80 block">{tier.subDescription.who}</span>
                            </CardDescription>
                          </div>
                          <div className="space-y-4 mt-auto">
                            {tier.features.map((feature) => (
                              <FeatureItem key={feature.name} {...feature} />
                            ))}
                          </div>
                        </CardContent>
                        <CardFooter className="mt-auto">
                          <div className="w-full space-y-4">
                            <ApiKeySection apiKeys={tier.apiKeys} />
                            <Button className="w-full">{tier.cta}</Button>
                          </div>
                        </CardFooter>
                      </div>
                    </Card>
                  </div>
                )}
              </motion.div>
            ))}
          </div>

          {/* Organizational Support Tiers */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {[tiers[1], tiers[3]].map((tier, index) => (
              <motion.div
                key={tier.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
              >
                {index === 0 ? (
                  <div className="relative h-full">
                    <div className="absolute inset-0 -z-10 rounded-md overflow-hidden">
                      <GradientFlow
                        duration={20}
                        colors={['#ECC5FF', '#FFE5C4', '#FEF5D0']}
                        fullWidth
                        radialOverlay
                        blurAmount="20px"
                      >
                        <div className="w-full h-full after:content-[''] after:absolute after:inset-0 after:bg-[url('/noise.png')] after:opacity-10 after:mix-blend-overlay" />
                      </GradientFlow>
                    </div>
                    <div className="absolute -inset-4 pointer-events-none z-10">
                      <FloatingSparkle className="absolute top-1/3 left-2" style={{ animationDelay: '0.5s' }}>✨</FloatingSparkle>
                      <FloatingSparkle className="absolute top-1/2 right-2" style={{ animationDelay: '0.1s' }}>✨</FloatingSparkle>
                      <FloatingSparkle className="absolute bottom-0 left-0" style={{ animationDelay: '0.8s' }}>✨</FloatingSparkle>
                    </div>
                    <GlowingCard
                      background="linear-gradient(225deg, #ECC5FF, #FFE5C4, #FEF5D0)"
                      darkBackground="linear-gradient(225deg, rgba(236, 197, 255, 0.1), rgba(255, 229, 196, 0.1), rgba(254, 245, 208, 0.1))"
                      glowIntensity={0.1}
                      glowSize={60}
                      glowColor="236, 197, 255"
                    >
                      <Card className="h-full">
                        <div className="flex flex-col h-full">
                          <CardHeader>
                            <div className="flex items-center justify-between mb-4">
                              <CardTitle className="text-2xl font-bold">{tier.name}</CardTitle>
                              <tier.icon className="h-8 w-8 text-purple-500" />
                            </div>
                            <CardDescription className="text-primary">
                              <span className="mb-2 block">{tier.description}</span>
                              <span className="text-sm text-primary opacity-80 block">{tier.subDescription.who}</span>
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="flex-grow">
                            <div className="text-3xl font-bold mb-6">
                              {tier.price}
                              {tier.period && <span className="text-base font-normal">{tier.period}</span>}
                            </div>
                            <div className="space-y-4">
                              {tier.features.map((feature) => (
                                <FeatureItem key={feature.name} {...feature} />
                              ))}
                            </div>
                          </CardContent>
                          <CardFooter className="mt-auto">
                            <div className="w-full space-y-4">
                              <ApiKeySection apiKeys={tier.apiKeys} />
                              <Button className="w-full">{tier.cta}</Button>
                            </div>
                          </CardFooter>
                        </div>
                      </Card>
                    </GlowingCard>
                  </div>
                ) : (
                  <div className="relative h-full">
                    <div className="absolute inset-0 -z-10 rounded-md overflow-hidden bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-zinc-800 dark:to-zinc-900">
                      <div className="absolute inset-0 bg-[url('/noise.png')] opacity-30 mix-blend-overlay pointer-events-none" />
                    </div>
                    <Card className="h-full transition-[border-color] duration-200 border border-zinc-200/30 dark:border-zinc-700/30 hover:border-zinc-300 dark:hover:border-zinc-600">
                      <div className="flex flex-col h-full">
                        <CardHeader>
                          <div className="flex items-center justify-between mb-4">
                            <CardTitle className="text-2xl font-bold">{tier.name}</CardTitle>
                            <tier.icon className="h-8 w-8 text-purple-500" />
                          </div>
                          <CardDescription className="text-primary">
                            <span className="mb-2 block">{tier.description}</span>
                            <span className="text-sm text-primary opacity-80 block">{tier.subDescription.who}</span>
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="flex-grow">
                          <div className="text-3xl font-bold mb-6">
                            {tier.price}
                            {tier.period && <span className="text-base font-normal">{tier.period}</span>}
                          </div>
                          <div className="space-y-4">
                            {tier.features.map((feature) => (
                              <FeatureItem key={feature.name} {...feature} />
                            ))}
                          </div>
                        </CardContent>
                        <CardFooter className="mt-auto">
                          <div className="w-full space-y-4">
                            <ApiKeySection apiKeys={tier.apiKeys} />
                            <Button className="w-full">{tier.cta}</Button>
                          </div>
                        </CardFooter>
                      </div>
                    </Card>
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        </div>

        <motion.div
          className="mt-20 max-w-3xl mx-auto text-center px-4"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          <h2 className="text-3xl font-bold mb-4">
            Why Support Open Politics?
          </h2>
          <p className="text-xl mb-8">
            By contributing financially, you ensure continued open-source development that benefits everyone—especially
            those working in the public interest.
          </p>
          <Button
            size="lg"
            className=""
          >
            <a href="https://docs.open-politics.org/pages/app/overview/pages/project/manifest">
            Learn More About Our Mission
            </a>
          </Button>
        </motion.div>
        <FAQSection />
      </div>
    </section>
  )
}
