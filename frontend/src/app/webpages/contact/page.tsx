'use client';

import React from "react";
import { motion } from "framer-motion";
import { Mail, Calendar, MessageSquare } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import TextWriter from "@/components/ui/extra-animated-base-components/text-writer";
import GradientFlow from "@/components/ui/extra-animated-base-components/gradient-flow";

const ContactPage: React.FC = () => {
  return (
    <section className="py-20">
      <div className="container mx-auto px-4">
        {/* Header Section */}
        <motion.div
          className="max-w-2xl mx-auto mb-16 text-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
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
              text="get in touch"
              className=""
              typingDelay={50}
              startDelay={200}
              cursorColor="currentColor"
            />
          </h1>
          <p className="text-xl">
            Have questions? We'd love to hear from you.
          </p>
        </motion.div>

        {/* Contact Options Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto mb-16">
          {/* Email Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            whileHover={{ scale: 1.05 }}
            className=""
          >
            <div className="relative h-full">
              <div className="absolute inset-0 -z-10 rounded-md overflow-hidden">
                <GradientFlow
                  duration={15}
                  colors={['var(--dot-color-1)', 'var(--dot-color-2)', 'var(--dot-color-3)']}
                  fullWidth
                  radialOverlay
                  blurAmount="15px"
                >
                  <div className="w-full h-full after:content-[''] after:absolute after:inset-0 after:bg-[url('/noise.png')] after:opacity-20 after:mix-blend-overlay" />
                </GradientFlow>
              </div>
              <Card className="h-full">
                <CardHeader>
                  <div className="flex items-center justify-between mb-4">
                    <CardTitle className="text-2xl font-bold text-black">Email Us</CardTitle>
                    <Mail className="h-8 w-8 text-black" />
                  </div>
                  <CardDescription className="text-gray-600">
                    Send us an email anytime
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button 
                    className="w-full"
                    onClick={() => window.location.href = 'mailto:engage@open-politics.org'}
                  >
                    engage@open-politics.org
                  </Button>
                </CardContent>
              </Card>
            </div>
          </motion.div>

          {/* Schedule Meeting Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15, delay: 0 }}
            whileHover={{ scale: 1.05 }}
            className=""
          >
            <div className="relative h-full">
              <div className="absolute inset-0 -z-10 rounded-md overflow-hidden">
                <GradientFlow
                  duration={15}
                  colors={['var(--dot-color-5)', 'var(--dot-color-4)', 'var(--dot-color-3)']}
                  fullWidth
                  radialOverlay
                  blurAmount="15px"
                >
                  <div className="w-full h-full after:content-[''] after:absolute after:inset-0 after:bg-[url('/noise.png')] after:opacity-20 after:mix-blend-overlay" />
                </GradientFlow>
              </div>
              <Card className="h-full">
                <CardHeader>
                  <div className="flex items-center justify-between mb-4">
                    <CardTitle className="text-2xl font-bold text-black">Schedule a Meeting</CardTitle>
                    <Calendar className="h-8 w-8 text-black" />
                  </div>
                  <CardDescription className="text-gray-600">
                    Book a time to chat with us
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button 
                    className="w-full"
                    onClick={() => window.open('https://cloud.open-politics.org/apps/appointments/pub/4cVM1bYZ8N1NBAGb/form', '_blank')}
                  >
                    Schedule Now
                  </Button>
                </CardContent>
              </Card>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default ContactPage;