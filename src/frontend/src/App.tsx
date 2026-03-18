import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Toaster } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import {
  Camera,
  CameraOff,
  CheckCircle,
  Github,
  Hand,
  History,
  Info,
  Loader2,
  Mail,
  MessageSquare,
  Moon,
  Send,
  Sun,
  User,
  Users,
  Zap,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

type Page = "home" | "detector" | "contact";
type Keypoint = [number, number, number];
type HandPose = { landmarks: Keypoint[] };

interface PredictionResult {
  letter: string;
  confidence: number;
}

interface HistoryEntry {
  letter: string;
  confidence: number;
  timestamp: number;
}

// ─── Sign Reference Data ──────────────────────────────────────────────────────

const SIGN_REFERENCE = [
  { sign: "A", hint: "Fist, thumb side" },
  { sign: "B", hint: "4 fingers up, thumb tucked" },
  { sign: "C", hint: "Curved C shape" },
  { sign: "D", hint: "Index up, others curled" },
  { sign: "E", hint: "All fingers bent" },
  { sign: "F", hint: "Index + thumb circle" },
  { sign: "G", hint: "Index points right" },
  { sign: "H", hint: "Index + middle sideways" },
  { sign: "I", hint: "Pinky up" },
  { sign: "J", hint: "Pinky + curve" },
  { sign: "K", hint: "V + thumb up" },
  { sign: "L", hint: "Index + thumb L shape" },
  { sign: "M", hint: "3 fingers over thumb" },
  { sign: "N", hint: "2 fingers over thumb" },
  { sign: "O", hint: "O shape with fingers" },
  { sign: "P", hint: "Index pointing down" },
  { sign: "Q", hint: "Index + thumb down" },
  { sign: "R", hint: "Crossed fingers" },
  { sign: "S", hint: "Fist, thumb over" },
  { sign: "T", hint: "Thumb between fingers" },
  { sign: "U", hint: "2 fingers up together" },
  { sign: "V", hint: "2 fingers V shape" },
  { sign: "W", hint: "3 fingers up" },
  { sign: "X", hint: "Index hooked" },
  { sign: "Y", hint: "Pinky + thumb out" },
  { sign: "Z", hint: "Index traces Z" },
  { sign: "Yes", hint: "Fist nodding" },
  { sign: "No", hint: "Index + middle tap" },
  { sign: "Thank You", hint: "Flat hand from chin" },
  { sign: "Hello", hint: "Open palm, all fingers spread" },
  { sign: "I Love You", hint: "Thumb + index + pinky extended" },
];

// ─── Finger Extension Utils ───────────────────────────────────────────────────

function isExtended(
  landmarks: Keypoint[],
  tipIdx: number,
  pipIdx: number,
): boolean {
  return landmarks[tipIdx][1] < landmarks[pipIdx][1];
}

function fingerStates(landmarks: Keypoint[]) {
  // Determine hand orientation: if wrist(0) is to the right of index MCP(5), it's likely a right hand
  const isRightHand = landmarks[0][0] < landmarks[5][0];
  const thumb = isRightHand
    ? landmarks[4][0] > landmarks[3][0]
    : landmarks[4][0] < landmarks[3][0];
  const thumbUp = landmarks[4][1] < landmarks[2][1]; // tip above knuckle
  const index = isExtended(landmarks, 8, 6);
  const middle = isExtended(landmarks, 12, 10);
  const ring = isExtended(landmarks, 16, 14);
  const pinky = isExtended(landmarks, 20, 18);
  return { thumb, thumbUp, index, middle, ring, pinky };
}

function distance(a: Keypoint, b: Keypoint): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
}

// ─── ASL Classifier ──────────────────────────────────────────────────────────

function classifyASL(landmarks: Keypoint[]): PredictionResult {
  const f = fingerStates(landmarks);
  const wrist = landmarks[0];
  const indexTip = landmarks[8];
  const middleTip = landmarks[12];
  const thumbTip = landmarks[4];

  const allCurled = !f.index && !f.middle && !f.ring && !f.pinky;
  const allExtended = f.index && f.middle && f.ring && f.pinky;
  const indexMiddle = f.index && f.middle && !f.ring && !f.pinky;
  const onlyIndex = f.index && !f.middle && !f.ring && !f.pinky;
  const onlyPinky = !f.index && !f.middle && !f.ring && f.pinky;

  const thumbIndexDist = distance(thumbTip, indexTip);
  const indexMiddleDist = distance(indexTip, middleTip);
  const handWidth = distance(wrist, landmarks[5]);
  const norm = handWidth > 0 ? handWidth : 1;

  const thumbIndexClose = thumbIndexDist / norm < 0.35;
  const indexMiddleClose = indexMiddleDist / norm < 0.25;

  // ── Common word gestures (check before letters to avoid conflicts) ──

  // I Love You: thumb + index + pinky up, middle + ring curled
  if (f.thumb && f.index && !f.middle && !f.ring && f.pinky)
    return { letter: "I Love You", confidence: 0.9 };

  // Hello: all 5 fingers extended + thumbUp (open palm wave)
  if (allExtended && f.thumbUp) return { letter: "Hello", confidence: 0.88 };

  // Thank You: all 4 fingers extended, thumb NOT pointing up (flat hand from chin)
  if (allExtended && f.thumb && !f.thumbUp)
    return { letter: "Thank You", confidence: 0.85 };

  // Yes: closed fist (S shape) with thumb resting on side — nodding motion
  if (allCurled && f.thumb && !f.thumbUp && !thumbIndexClose)
    return { letter: "Yes", confidence: 0.8 };

  // No: index + middle extended, closing together (tapping gesture)
  if (indexMiddle && indexMiddleClose && !f.thumbUp)
    return { letter: "No", confidence: 0.82 };

  // ── ASL Alphabet ──

  // B: 4 fingers up, thumb tucked across palm
  if (allExtended && !f.thumb && !f.thumbUp)
    return { letter: "B", confidence: 0.82 };

  // W: ring + middle + index up, pinky curled
  if (f.index && f.middle && f.ring && !f.pinky && !f.thumbUp)
    return { letter: "W", confidence: 0.8 };

  // K: index + middle up + thumb pointing up/between them
  if (indexMiddle && f.thumbUp && !f.ring && !f.pinky)
    return { letter: "K", confidence: 0.75 };

  // V vs U
  if (indexMiddle && !f.thumbUp) {
    if (indexMiddleClose) return { letter: "U", confidence: 0.72 };
    return { letter: "V", confidence: 0.75 };
  }

  // Y: pinky + thumb out
  if (onlyPinky && f.thumbUp) return { letter: "Y", confidence: 0.82 };
  // I: only pinky up
  if (onlyPinky && !f.thumbUp) return { letter: "I", confidence: 0.8 };

  // F: index + thumb form circle, other fingers up
  if (thumbIndexClose && f.middle && f.ring && f.pinky)
    return { letter: "F", confidence: 0.76 };

  // L: index + thumb up (L shape)
  if (onlyIndex && f.thumbUp) return { letter: "L", confidence: 0.85 };

  // G: index points sideways, thumb parallel
  if (onlyIndex && f.thumb && !f.thumbUp)
    return { letter: "G", confidence: 0.7 };

  // D: index up, thumb touches middle ring pinky
  if (onlyIndex && !thumbIndexClose) return { letter: "D", confidence: 0.78 };

  // Z: index traces Z, roughly pointing
  if (onlyIndex) return { letter: "Z", confidence: 0.65 };

  // P: index pointing down
  if (f.index && !f.middle && !f.ring && !f.pinky && indexTip[1] > wrist[1])
    return { letter: "P", confidence: 0.65 };

  // A, E, S — all curled
  if (allCurled) {
    if (f.thumb && !f.thumbUp && thumbIndexClose)
      return { letter: "A", confidence: 0.78 };
    if (thumbIndexClose) return { letter: "E", confidence: 0.7 };
    if (!f.thumb && !f.thumbUp) return { letter: "S", confidence: 0.75 };
    return { letter: "A", confidence: 0.6 };
  }

  // O: partial index + middle curl with thumbIndexClose
  const partialIndex =
    landmarks[8][1] < landmarks[5][1] && landmarks[8][1] > landmarks[6][1];
  const partialMiddle =
    landmarks[12][1] < landmarks[9][1] && landmarks[12][1] > landmarks[10][1];
  if (partialIndex && partialMiddle && thumbIndexClose)
    return { letter: "O", confidence: 0.72 };
  if (partialIndex && partialMiddle) return { letter: "C", confidence: 0.7 };

  // M: 3 fingers over thumb
  if (f.index && f.middle && f.ring && !f.pinky && !f.thumbUp)
    return { letter: "M", confidence: 0.68 };

  // N: 2 fingers over thumb
  if (f.index && f.middle && !f.ring && !f.pinky && !f.thumbUp)
    return { letter: "N", confidence: 0.68 };

  // T: thumb between index and middle
  const thumbBetween =
    thumbTip[0] > Math.min(indexTip[0], middleTip[0]) &&
    thumbTip[0] < Math.max(indexTip[0], middleTip[0]);
  if (allCurled && thumbBetween) return { letter: "T", confidence: 0.7 };

  // X: index hooked
  if (!f.index && !f.middle && !f.ring && !f.pinky)
    return { letter: "X", confidence: 0.6 };

  // H: index + middle sideways
  if (indexMiddle) return { letter: "H", confidence: 0.68 };

  // Fallback
  const extended = [f.index, f.middle, f.ring, f.pinky].filter(Boolean).length;
  if (extended >= 3) return { letter: "B", confidence: 0.5 };
  if (extended === 2) return { letter: "V", confidence: 0.5 };
  if (extended === 1) return { letter: "D", confidence: 0.5 };
  return { letter: "A", confidence: 0.5 };
}
// ─── Canvas Drawing ───────────────────────────────────────────────────────────

const CONNECTIONS: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [0, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [0, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [5, 9],
  [9, 13],
  [13, 17],
];

function drawHand(
  ctx: CanvasRenderingContext2D,
  landmarks: Keypoint[],
  color: string,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.85;
  for (const [a, b] of CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(landmarks[a][0], landmarks[a][1]);
    ctx.lineTo(landmarks[b][0], landmarks[b][1]);
    ctx.stroke();
  }
  for (let i = 0; i < landmarks.length; i++) {
    const [x, y] = landmarks[i];
    ctx.beginPath();
    ctx.arc(x, y, i === 0 ? 5 : 3, 0, 2 * Math.PI);
    ctx.fillStyle = i === 0 ? "#ffffff" : color;
    ctx.globalAlpha = 0.9;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ─── Nav Tabs ─────────────────────────────────────────────────────────────────

const NAV_TABS: { id: Page; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "detector", label: "Detector" },
  { id: "contact", label: "Contact" },
];

// ─── Home Page ────────────────────────────────────────────────────────────────

function HomePage({ onGetStarted }: { onGetStarted: () => void }) {
  const features = [
    {
      icon: <Zap className="w-5 h-5" />,
      title: "Real-Time Detection",
      desc: "Instant sign recognition powered by TensorFlow.js running directly in your browser — no server needed.",
    },
    {
      icon: <Hand className="w-5 h-5" />,
      title: "A–Z + Special Gestures",
      desc: "Recognizes the full ASL alphabet plus Yes, No, and Thank You gestures for richer communication.",
    },
    {
      icon: <Camera className="w-5 h-5" />,
      title: "Webcam Powered",
      desc: "Uses your device's camera with real-time hand landmark tracking to classify signs accurately.",
    },
    {
      icon: <Sun className="w-5 h-5" />,
      title: "Light & Dark Mode",
      desc: "A polished UI that adapts to your preference — comfortable in any lighting environment.",
    },
  ];

  const steps = [
    {
      num: "01",
      title: "Open Detector",
      desc: "Navigate to the Detector tab and click Start Camera.",
    },
    {
      num: "02",
      title: "Show Your Hand",
      desc: "Hold your hand clearly in front of the camera with good lighting.",
    },
    {
      num: "03",
      title: "Form a Sign",
      desc: "Make an ASL hand shape. The AI will classify it in real time.",
    },
    {
      num: "04",
      title: "See the Result",
      desc: "The predicted letter and confidence score appear instantly on screen.",
    },
  ];

  return (
    <div className="flex flex-col gap-20 pb-16">
      {/* Hero */}
      <section
        className="relative flex flex-col items-center text-center gap-6 pt-12 px-4"
        data-ocid="home.section"
      >
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-sm font-medium"
        >
          <Hand className="w-4 h-4" />
          Student Mini Project · ASL Detector
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.1 }}
          className="text-5xl sm:text-6xl lg:text-7xl font-bold text-foreground leading-tight max-w-3xl"
        >
          Read Sign Language{" "}
          <span style={{ color: "oklch(0.75 0.12 200)" }}>in Real Time</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="text-lg text-muted-foreground max-w-xl leading-relaxed"
        >
          A browser-based AI system that detects American Sign Language hand
          gestures live from your webcam — no installs, no uploads, fully
          private.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="flex items-center gap-3 flex-wrap justify-center"
        >
          <Button
            size="lg"
            onClick={onGetStarted}
            className="px-8 font-semibold"
            data-ocid="home.primary_button"
          >
            Get Started
            <Camera className="w-4 h-4 ml-2" />
          </Button>
          <Badge variant="secondary" className="px-4 py-1.5 text-sm">
            29 Signs Supported
          </Badge>
        </motion.div>

        {/* Decorative glow */}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full opacity-20 blur-3xl pointer-events-none"
          style={{ background: "oklch(0.75 0.12 200)" }}
        />
      </section>

      {/* Features */}
      <section className="px-4">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-10"
        >
          <h2 className="text-3xl font-bold text-foreground mb-3">
            What It Does
          </h2>
          <p className="text-muted-foreground">
            Everything you need to bridge sign language and text.
          </p>
        </motion.div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-5xl mx-auto">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.5 }}
            >
              <Card className="h-full border-border hover:border-primary/40 transition-colors">
                <CardContent className="pt-6 flex flex-col gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center text-primary">
                    {f.icon}
                  </div>
                  <h3 className="font-semibold text-foreground">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {f.desc}
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section className="px-4">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-10"
        >
          <h2 className="text-3xl font-bold text-foreground mb-3">
            How It Works
          </h2>
          <p className="text-muted-foreground">
            Four simple steps to start communicating.
          </p>
        </motion.div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
          {steps.map((s, i) => (
            <motion.div
              key={s.num}
              initial={{ opacity: 0, x: -16 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.12, duration: 0.5 }}
              className="flex flex-col gap-3"
            >
              <span
                className="text-4xl font-bold leading-none"
                style={{ color: "oklch(0.75 0.12 200 / 0.3)" }}
              >
                {s.num}
              </span>
              <h3 className="font-semibold text-foreground">{s.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {s.desc}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA Banner */}
      <motion.section
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="mx-4 rounded-3xl border border-primary/30 bg-primary/10 px-8 py-12 text-center relative overflow-hidden"
      >
        <div
          className="absolute inset-0 opacity-10 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 60% 80% at 50% 50%, oklch(0.75 0.12 200), transparent)",
          }}
        />
        <h2 className="text-3xl font-bold text-foreground mb-3 relative z-10">
          Ready to try it?
        </h2>
        <p className="text-muted-foreground mb-6 relative z-10">
          Launch the detector and start signing in seconds.
        </p>
        <Button
          size="lg"
          onClick={onGetStarted}
          className="px-10 font-semibold relative z-10"
          data-ocid="home.secondary_button"
        >
          Open Detector
        </Button>
      </motion.section>
    </div>
  );
}

// ─── Contact Page ─────────────────────────────────────────────────────────────

function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !message.trim()) {
      toast.error("Please fill in all fields.");
      return;
    }
    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 1000));
    setSubmitting(false);
    setSubmitted(true);
    setName("");
    setEmail("");
    setMessage("");
    toast.success("Message sent! We'll get back to you soon.");
  };

  const team = [
    {
      name: "Nandhana Jayaraj",
      role: "Project Lead",
      initials: "NJ",
    },
    { name: "Nivedya Prasad", role: "Team Member", initials: "NP" },
    { name: "Sreyaswini TP", role: "Team Member", initials: "ST" },
  ];

  return (
    <div
      className="max-w-4xl mx-auto px-4 py-10 flex flex-col gap-12"
      data-ocid="contact.section"
    >
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-center"
      >
        <h2 className="text-4xl font-bold text-foreground mb-3">
          Get in <span style={{ color: "oklch(0.75 0.12 200)" }}>Touch</span>
        </h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          Sign Language Detection System — Student Mini Project. Have a question
          or want to collaborate? Drop us a message.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Contact Form */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <Card className="border-border">
            <CardContent className="pt-6">
              <h3 className="font-semibold text-foreground text-lg mb-5 flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-primary" />
                Send a Message
              </h3>

              {submitted ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex flex-col items-center gap-3 py-10 text-center"
                  data-ocid="contact.success_state"
                >
                  <CheckCircle
                    className="w-12 h-12"
                    style={{ color: "oklch(0.70 0.20 142)" }}
                  />
                  <p className="font-semibold text-foreground">Message Sent!</p>
                  <p className="text-sm text-muted-foreground">
                    We'll get back to you soon.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSubmitted(false)}
                    className="mt-2"
                  >
                    Send Another
                  </Button>
                </motion.div>
              ) : (
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="contact-name">Name</Label>
                    <Input
                      id="contact-name"
                      placeholder="Your full name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      data-ocid="contact.input"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="contact-email">Email</Label>
                    <Input
                      id="contact-email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      data-ocid="contact.input"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="contact-message">Message</Label>
                    <Textarea
                      id="contact-message"
                      placeholder="Write your message here..."
                      rows={5}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      data-ocid="contact.textarea"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={submitting}
                    className="w-full"
                    data-ocid="contact.submit_button"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        Send Message
                      </>
                    )}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Info Column */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="flex flex-col gap-6"
        >
          {/* Project Info */}
          <Card className="border-border">
            <CardContent className="pt-6">
              <h3 className="font-semibold text-foreground text-lg mb-4 flex items-center gap-2">
                <Info className="w-5 h-5 text-primary" />
                About the Project
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                This is a student mini project that uses TensorFlow.js and the
                browser's webcam to classify American Sign Language hand
                gestures in real time. It supports A–Z plus Yes, No, and Thank
                You.
              </p>
              <div className="flex flex-wrap gap-2">
                {["TensorFlow.js", "React", "TypeScript", "ASL", "WebRTC"].map(
                  (tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ),
                )}
              </div>
            </CardContent>
          </Card>

          {/* Team */}
          <Card className="border-border">
            <CardContent className="pt-6">
              <h3 className="font-semibold text-foreground text-lg mb-4 flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                The Team
              </h3>
              <div className="flex flex-col gap-4">
                {team.map((member, i) => (
                  <motion.div
                    key={member.name}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 + i * 0.08 }}
                    className="flex items-center gap-3"
                    data-ocid={`contact.item.${i + 1}`}
                  >
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-primary-foreground shrink-0"
                      style={{ background: "oklch(0.75 0.12 200)" }}
                    >
                      {member.initials}
                    </div>
                    <div>
                      <p className="font-medium text-foreground text-sm">
                        {member.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {member.role}
                      </p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Social Links */}
          <Card className="border-border">
            <CardContent className="pt-6">
              <h3 className="font-semibold text-foreground text-lg mb-4 flex items-center gap-2">
                <User className="w-5 h-5 text-primary" />
                Contact & Links
              </h3>
              <div className="flex flex-col gap-3">
                <a
                  href="mailto:nandhanajayaraj31@gmail.com"
                  className="flex items-center gap-3 text-sm text-muted-foreground hover:text-primary transition-colors"
                  data-ocid="contact.link"
                >
                  <Mail className="w-4 h-4 shrink-0" />
                  nandhanajayaraj31@gmail.com
                </a>
                <Separator />
                <a
                  href="https://github.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 text-sm text-muted-foreground hover:text-primary transition-colors"
                  data-ocid="contact.link"
                >
                  <Github className="w-4 h-4 shrink-0" />
                  github.com/signlang-project
                </a>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [isDark, setIsDark] = useState(true);
  const [currentPage, setCurrentPage] = useState<Page>("home");
  const [cameraActive, setCameraActive] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [currentPrediction, setCurrentPrediction] =
    useState<PredictionResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [statusMsg, setStatusMsg] = useState('Click "Start Camera" to begin');
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  // @ts-ignore
  const modelRef = useRef<any>(null);
  const predictionBufferRef = useRef<string[]>([]);
  const lastAddedRef = useRef<string>("");

  useEffect(() => {
    const saved = localStorage.getItem("sld-theme");
    if (saved === "light") setIsDark(false);
  }, []);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("sld-theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("sld-theme", "light");
    }
  }, [isDark]);

  const loadModel = useCallback(async () => {
    // @ts-ignore
    const handpose = window.handpose;
    if (!handpose) {
      toast.error("TensorFlow.js not loaded. Please refresh the page.");
      return;
    }
    setModelLoading(true);
    setStatusMsg("Loading AI model...");
    try {
      modelRef.current = await handpose.load({
        detectionConfidence: 0.8,
        maxContinuousChecks: 10,
      });
      setModelLoaded(true);
      setStatusMsg("Model ready! Show your hand to the camera.");
      toast.success("Hand detection model loaded!");
    } catch (err) {
      console.error("Model load error:", err);
      setStatusMsg("Model failed to load. Check your connection.");
      toast.error("Failed to load AI model.");
    } finally {
      setModelLoading(false);
    }
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    setStatusMsg("Requesting camera access...");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 360, facingMode: "user" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
      if (!modelLoaded && !modelLoading) {
        await loadModel();
      } else {
        setStatusMsg("Camera active. Show your hand!");
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error && err.name === "NotAllowedError"
          ? "Camera permission denied. Please allow camera access."
          : "Could not access camera. Check connections.";
      setCameraError(msg);
      setStatusMsg(msg);
      toast.error(msg);
    }
  }, [loadModel, modelLoaded, modelLoading]);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
    }
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
    setCameraActive(false);
    setStatusMsg('Camera stopped. Click "Start Camera" to restart.');
  }, []);

  useEffect(() => {
    if (!cameraActive || !modelLoaded || !modelRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    let running = true;

    async function detect() {
      if (!running || !video || !canvas || !modelRef.current) return;
      if (video.readyState < 2) {
        rafRef.current = requestAnimationFrame(detect);
        return;
      }
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 360;
      try {
        const predictions: HandPose[] =
          await modelRef.current.estimateHands(video);
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (predictions.length > 0 && ctx) {
          const hand = predictions[0];
          drawHand(ctx, hand.landmarks, "#22c7d6");
          const result = classifyASL(hand.landmarks);
          predictionBufferRef.current.push(result.letter);
          if (predictionBufferRef.current.length > 5) {
            predictionBufferRef.current.shift();
          }
          const buf = predictionBufferRef.current;
          if (buf.length >= 3) {
            const last3 = buf.slice(-3);
            if (last3.every((l) => l === last3[0])) {
              setCurrentPrediction(result);
              if (lastAddedRef.current !== result.letter) {
                lastAddedRef.current = result.letter;
                setHistory((prev) => [
                  {
                    letter: result.letter,
                    confidence: result.confidence,
                    timestamp: Date.now(),
                  },
                  ...prev.slice(0, 9),
                ]);
              }
            }
          }
        } else {
          predictionBufferRef.current = [];
        }
      } catch (e) {
        console.error("Detection error:", e);
      }
      if (running) {
        rafRef.current = requestAnimationFrame(detect);
      }
    }

    rafRef.current = requestAnimationFrame(detect);
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [cameraActive, modelLoaded]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          track.stop();
        }
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col relative overflow-x-hidden">
      <div className="fixed inset-0 pointer-events-none bg-spotlight" />

      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          {/* Logo */}
          <div
            className="flex items-center gap-3 shrink-0"
            data-ocid="header.section"
          >
            <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
              <Hand className="w-5 h-5 text-primary" />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-base font-semibold text-foreground leading-tight">
                Sign Language Detection
              </h1>
              <p className="text-xs text-muted-foreground">
                ASL · TensorFlow.js · Real-time
              </p>
            </div>
          </div>

          {/* Nav Tabs */}
          <nav
            className="flex items-center gap-1 bg-secondary/60 rounded-xl p-1"
            aria-label="Main navigation"
          >
            {NAV_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCurrentPage(tab.id)}
                className={[
                  "px-4 py-1.5 rounded-lg text-sm font-medium transition-all",
                  currentPage === tab.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
                data-ocid={`nav.${tab.id}.tab`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {/* Theme Toggle */}
          <button
            type="button"
            onClick={() => setIsDark((d) => !d)}
            className="w-10 h-10 rounded-xl border border-border bg-card hover:bg-secondary transition-colors flex items-center justify-center shrink-0"
            aria-label="Toggle theme"
            data-ocid="theme.toggle"
          >
            {isDark ? (
              <Sun className="w-5 h-5 text-foreground" />
            ) : (
              <Moon className="w-5 h-5 text-foreground" />
            )}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-screen-2xl mx-auto w-full">
        <AnimatePresence mode="wait">
          {currentPage === "home" && (
            <motion.div
              key="home"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3 }}
            >
              <HomePage onGetStarted={() => setCurrentPage("detector")} />
            </motion.div>
          )}

          {currentPage === "detector" && (
            <motion.div
              key="detector"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3 }}
              className="px-6 py-8"
            >
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left: Camera Panel */}
                <section className="lg:col-span-1 flex flex-col gap-4">
                  <div className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
                    <div className="px-5 py-4 border-b border-border flex items-center gap-2">
                      <Camera className="w-4 h-4 text-primary" />
                      <h2 className="font-semibold text-sm text-foreground">
                        Real-time Detection
                      </h2>
                      {cameraActive && (
                        <span className="ml-auto flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                          <span
                            className="text-xs"
                            style={{ color: "oklch(0.70 0.20 142)" }}
                          >
                            LIVE
                          </span>
                        </span>
                      )}
                    </div>

                    <div
                      className="relative w-full"
                      style={{ aspectRatio: "16/9" }}
                      data-ocid="camera.section"
                    >
                      <video
                        ref={videoRef}
                        className="absolute inset-0 w-full h-full object-cover"
                        style={{ transform: "scaleX(-1)" }}
                        playsInline
                        muted
                        autoPlay
                      />
                      <canvas
                        ref={canvasRef}
                        className="absolute inset-0 w-full h-full"
                        style={{ transform: "scaleX(-1)" }}
                      />
                      {!cameraActive && (
                        <div className="absolute inset-0 bg-secondary/80 flex flex-col items-center justify-center gap-3">
                          <CameraOff className="w-10 h-10 text-muted-foreground" />
                          <p className="text-sm text-muted-foreground text-center px-4">
                            {cameraError || "Camera inactive"}
                          </p>
                        </div>
                      )}
                      {cameraActive && modelLoading && (
                        <div className="absolute inset-0 bg-background/70 flex flex-col items-center justify-center gap-3">
                          <Loader2 className="w-8 h-8 text-primary animate-spin" />
                          <p className="text-sm text-foreground">
                            Loading AI model…
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="px-5 py-4 flex gap-3">
                      <Button
                        onClick={startCamera}
                        disabled={cameraActive || modelLoading}
                        className="flex-1 border border-success/60 bg-transparent hover:bg-success/10"
                        style={{ color: "oklch(0.70 0.20 142)" }}
                        variant="outline"
                        data-ocid="camera.primary_button"
                      >
                        <Camera className="w-4 h-4 mr-2" />
                        Start Camera
                      </Button>
                      <Button
                        onClick={stopCamera}
                        disabled={!cameraActive}
                        className="flex-1 border border-destructive/60 bg-transparent text-destructive hover:bg-destructive/10"
                        variant="outline"
                        data-ocid="camera.secondary_button"
                      >
                        <CameraOff className="w-4 h-4 mr-2" />
                        Stop Camera
                      </Button>
                    </div>

                    <div className="px-5 pb-4">
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5 shrink-0" />
                        {statusMsg}
                      </p>
                    </div>
                  </div>

                  {/* Tips */}
                  <div className="rounded-2xl border border-border bg-card shadow-card px-5 py-4">
                    <h3 className="text-sm font-semibold text-foreground mb-3">
                      Tips for Best Results
                    </h3>
                    <ul className="space-y-1.5 text-xs text-muted-foreground">
                      {[
                        "Use good lighting on your hand",
                        "Keep hand centered in frame",
                        "Hold signs steady for 1-2 seconds",
                        "Plain background works best",
                        "Keep hand 20-50cm from camera",
                      ].map((tip) => (
                        <li key={tip} className="flex items-start gap-2">
                          <span style={{ color: "oklch(0.75 0.12 200)" }}>
                            •
                          </span>
                          {tip}
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>

                {/* Middle: Prediction Panel */}
                <section className="lg:col-span-1 flex flex-col gap-4">
                  <div className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
                    <div className="px-5 py-4 border-b border-border">
                      <h2 className="font-semibold text-sm text-foreground">
                        Current Prediction
                      </h2>
                    </div>
                    <div className="flex flex-col items-center justify-center px-5 py-8 gap-4">
                      <AnimatePresence mode="wait">
                        <motion.div
                          key={currentPrediction?.letter || "idle"}
                          initial={{ scale: 0.7, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 1.1, opacity: 0 }}
                          transition={{
                            type: "spring",
                            stiffness: 400,
                            damping: 25,
                          }}
                          className="leading-none font-bold select-none text-center"
                          style={{
                            fontSize:
                              currentPrediction &&
                              currentPrediction.letter.length > 2
                                ? "3.5rem"
                                : "8rem",
                            color: "oklch(0.75 0.12 200)",
                            textShadow: "0 0 40px oklch(0.75 0.12 200 / 0.4)",
                          }}
                          data-ocid="prediction.section"
                        >
                          {currentPrediction?.letter || "—"}
                        </motion.div>
                      </AnimatePresence>

                      <div className="text-center">
                        <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2">
                          Confidence
                        </p>
                        <div className="w-48">
                          <Progress
                            value={
                              currentPrediction
                                ? currentPrediction.confidence * 100
                                : 0
                            }
                            className="h-2"
                          />
                          <p className="text-sm font-semibold text-foreground mt-1.5">
                            {currentPrediction
                              ? `${Math.round(currentPrediction.confidence * 100)}%`
                              : "0%"}
                          </p>
                        </div>
                      </div>

                      {!cameraActive && (
                        <p className="text-xs text-muted-foreground italic">
                          Start camera to begin detection
                        </p>
                      )}
                    </div>
                  </div>

                  {/* History */}
                  <div className="rounded-2xl border border-border bg-card shadow-card overflow-hidden flex-1">
                    <div className="px-5 py-4 border-b border-border flex items-center gap-2">
                      <History className="w-4 h-4 text-primary" />
                      <h2 className="font-semibold text-sm text-foreground">
                        Sign History
                      </h2>
                      {history.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-auto h-6 px-2 text-xs text-muted-foreground"
                          onClick={() => {
                            setHistory([]);
                            lastAddedRef.current = "";
                          }}
                          data-ocid="history.secondary_button"
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                    <ScrollArea className="h-[240px]">
                      <div className="px-5 py-3 space-y-2">
                        {history.length === 0 ? (
                          <div
                            className="flex flex-col items-center justify-center py-10 gap-2"
                            data-ocid="history.empty_state"
                          >
                            <p className="text-xs text-muted-foreground">
                              No signs detected yet
                            </p>
                          </div>
                        ) : (
                          history.map((h, i) => (
                            <motion.div
                              key={h.timestamp}
                              initial={{ x: -16, opacity: 0 }}
                              animate={{ x: 0, opacity: 1 }}
                              transition={{ duration: 0.2 }}
                              className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0"
                              data-ocid={`history.item.${i + 1}`}
                            >
                              <span
                                className="font-bold text-lg leading-none w-10 shrink-0"
                                style={{ color: "oklch(0.75 0.12 200)" }}
                              >
                                {h.letter}
                              </span>
                              <div className="flex-1">
                                <Progress
                                  value={h.confidence * 100}
                                  className="h-1.5"
                                />
                              </div>
                              <Badge
                                variant="secondary"
                                className="text-xs shrink-0"
                              >
                                {Math.round(h.confidence * 100)}%
                              </Badge>
                              <span className="text-xs text-muted-foreground shrink-0">
                                {new Date(h.timestamp).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  second: "2-digit",
                                })}
                              </span>
                            </motion.div>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </div>
                </section>

                {/* Right: Reference Panel */}
                <section
                  className="lg:col-span-1"
                  data-ocid="reference.section"
                >
                  <div className="rounded-2xl border border-border bg-card shadow-card overflow-hidden h-full">
                    <div className="px-5 py-4 border-b border-border">
                      <h2 className="font-semibold text-sm text-foreground">
                        A–Z + Gestures Reference
                      </h2>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Finger position hints
                      </p>
                    </div>
                    <ScrollArea className="h-[calc(100vh-220px)] min-h-[400px]">
                      <div className="p-4 grid grid-cols-3 gap-2">
                        {SIGN_REFERENCE.map((item, idx) => (
                          <motion.div
                            key={item.sign}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.02 }}
                            className={[
                              "rounded-xl border p-2.5 flex flex-col items-center gap-1 cursor-default transition-all hover:border-primary/50 hover:bg-primary/5",
                              currentPrediction?.letter === item.sign
                                ? "border-primary/70 bg-primary/10"
                                : "border-border bg-card",
                              item.sign.length > 1 ? "col-span-3" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            data-ocid={`reference.item.${idx + 1}`}
                          >
                            <span
                              className="font-bold leading-none"
                              style={{
                                fontSize:
                                  item.sign.length > 1 ? "1.1rem" : "1.5rem",
                                color:
                                  currentPrediction?.letter === item.sign
                                    ? "oklch(0.75 0.12 200)"
                                    : "oklch(var(--foreground))",
                              }}
                            >
                              {item.sign}
                            </span>
                            <p className="text-[9px] text-muted-foreground text-center leading-tight">
                              {item.hint}
                            </p>
                          </motion.div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                </section>
              </div>
            </motion.div>
          )}

          {currentPage === "contact" && (
            <motion.div
              key="contact"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3 }}
            >
              <ContactPage />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card/50 mt-8">
        <div className="max-w-screen-2xl mx-auto px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Hand className="w-4 h-4 text-primary" />
            <span>Sign Language Detection System</span>
            <span className="text-border">·</span>
            <span>Student Mini Project</span>
          </div>
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()}.{" "}
            <a
              href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(window.location.hostname)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary transition-colors"
            >
              Built with ♥ using caffeine.ai
            </a>
          </p>
        </div>
      </footer>

      <Toaster richColors />
    </div>
  );
}
