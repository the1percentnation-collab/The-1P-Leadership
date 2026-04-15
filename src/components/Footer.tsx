import Link from "next/link";

const quickLinks = [
  { href: "/", label: "Home" },
  { href: "/courses", label: "Courses" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/certification", label: "Certification" },
];

const socialLinks = [
  { href: "#", label: "Twitter" },
  { href: "#", label: "LinkedIn" },
  { href: "#", label: "Instagram" },
  { href: "mailto:contact@onepercentnation.com", label: "Email" },
];

export default function Footer() {
  return (
    <footer className="bg-slate-900 text-slate-300 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-amber-400 text-2xl font-bold">&#9670;</span>
              <span className="text-lg font-bold text-white tracking-tight">
                The One Percent Nation
              </span>
            </div>
            <p className="text-sm text-slate-400 leading-relaxed max-w-xs">
              From Potential to Purpose. A leadership certification platform
              dedicated to developing the next generation of transformational
              leaders.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="text-white text-sm font-semibold uppercase tracking-wider mb-4">
              Quick Links
            </h3>
            <ul className="space-y-2">
              {quickLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-slate-400 hover:text-amber-400 transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact / Social */}
          <div>
            <h3 className="text-white text-sm font-semibold uppercase tracking-wider mb-4">
              Connect
            </h3>
            <ul className="space-y-2">
              {socialLinks.map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    className="text-sm text-slate-400 hover:text-amber-400 transition-colors"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Copyright */}
        <div className="mt-10 pt-6 border-t border-slate-700 text-center">
          <p className="text-sm text-slate-500">
            &copy; {new Date().getFullYear()} The One Percent Nation. All rights
            reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
