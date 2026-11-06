import './LandingPage.css'

function ProfilesIcon() {
  return <svg width="88" height="88" viewBox="0 0 88 88" fill="none" strokeLinecap="round" aria-hidden="true">
    {[26, 44, 62].map((y) => <line key={y} x1="18" y1={y} x2="70" y2={y} stroke="#4a4a52" strokeWidth="3" />)}
    <line x1="18" y1="26" x2="34" y2="26" stroke="#8b66ff" strokeWidth="3" />
    <line x1="18" y1="44" x2="56" y2="44" stroke="#8b66ff" strokeWidth="3" />
    <line x1="18" y1="62" x2="44" y2="62" stroke="#8b66ff" strokeWidth="3" />
    {[[34, 26], [56, 44], [44, 62]].map(([x, y]) => <circle key={y} cx={x} cy={y} r="6" fill="#1e1e22" stroke="#ececf0" strokeWidth="2.5" />)}
  </svg>
}

function ReportsIcon() {
  return <svg width="88" height="88" viewBox="0 0 88 88" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M24 14h28l14 14v46H24z" stroke="#ececf0" strokeWidth="2.5" />
    <path d="M52 14v14h14" stroke="#ececf0" strokeWidth="2.5" />
    <line x1="32" y1="62" x2="32" y2="54" stroke="#4a4a52" strokeWidth="5" />
    <line x1="42" y1="62" x2="42" y2="46" stroke="#4a4a52" strokeWidth="5" />
    <line x1="52" y1="62" x2="52" y2="40" stroke="#8b66ff" strokeWidth="5" />
    <line x1="32" y1="32" x2="44" y2="32" stroke="#4a4a52" strokeWidth="2.5" />
  </svg>
}

const tools = [
  {
    name: 'Resolution',
    description: 'Find the smallest resolved element and report lp/mm with a scanline overlay.',
    href: '#/analysis',
    image: '/sample-overlay.png',
    imageAlt: 'USAF target with an annotated scanline overlay',
  },
  {
    name: 'Characterization profiles',
    description: 'Save your microscope, objective and overlay settings as a profile and reuse them on every run.',
    href: '#/analysis',
    icon: <ProfilesIcon />,
  },
  {
    name: 'Reports in your account',
    description: 'Sign in to keep every analysis online and compare results over time.',
    href: '#/reports',
    icon: <ReportsIcon />,
  },
]

const steps = [
  { title: 'Open an image', description: 'Drop a PNG, TIFF or JPG with a USAF 1951 target in frame.' },
  { title: 'Pick an overlay style', description: 'Choose line and label colours that read on your image.' },
  { title: 'Analyze and export', description: 'Get lp/mm and resolution, then download the overlay or JSON.' },
]

export default function LandingPage() {
  return <div className="landing-page">
    <header className="landing-header"><a href="#/">OptiSuite Web</a></header>
    <main className="landing-main">
      <section className="landing-hero" aria-labelledby="landing-title">
        <h1 id="landing-title">Measure your microscope&apos;s resolution in the browser</h1>
        <p>Open an image of a USAF 1951 target and get lp/mm, the resolved group and element, and an annotated overlay. Nothing to install.</p>
        <a className="landing-cta" href="#/analysis"><span className="landing-play" aria-hidden="true" />Start an analysis</a>
      </section>

      <section className="landing-tools" aria-label="OptiSuite tools">
        {tools.map((tool, index) => <a className="landing-card" href={tool.href} key={tool.name} style={{ animationDelay: `${60 + index * 50}ms` }}>
          <div className="landing-card-visual">
            {tool.image ? <img src={tool.image} alt={tool.imageAlt} /> : tool.icon}
          </div>
          <div className="landing-card-copy">
            <h2>{tool.name}</h2>
            <p>{tool.description}</p>
          </div>
        </a>)}
      </section>

      <section className="landing-steps" aria-label="How it works">
        {steps.map((step, index) => <div className="landing-step" key={step.title}>
          <span className="landing-step-number" aria-hidden="true">{index + 1}</span>
          <div><h2>{step.title}</h2><p>{step.description}</p></div>
        </div>)}
      </section>
    </main>
    <footer className="landing-footer">OptiSuite Web</footer>
  </div>
}
