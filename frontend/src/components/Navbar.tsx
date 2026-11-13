import { NavLink } from 'react-router-dom';
import { Gamepad2, BookOpen, Map, Trophy, Info } from 'lucide-react';

export function Navbar() {
  const navItems = [
    { to: '/game', label: 'Игра', icon: Gamepad2 },
    { to: '/achievements', label: 'Достижения', icon: Trophy },
    { to: '/about', label: 'О сайте', icon: Info },
  ];

  return (
    <nav className="fixed top-0 z-50 w-full border-b border-border/40 bg-background/75 backdrop-blur  supports-[backdrop-filter]:bg-background/60">
      {/* Desktop Navigation */}
      <div className="hidden md:block">
        <div className="container flex h-16 items-center justify-center px-4">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-1">
              {navItems.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`
                  }
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Navigation */}
      <div className="md:hidden">
        {/* Mobile Menu */}
        <div className="border-t border-border/40">
          <div className="container flex items-center justify-around px-2 py-2">
            {navItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg transition-colors min-w-0 flex-1 max-w-[80px] ${
                    isActive
                      ? 'text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  }`
                }
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                <span className="text-[10px] leading-tight text-center truncate w-full">
                  {label}
                </span>
              </NavLink>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}
