'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Dashboard,
  Train,
  Location,
  Settings,
  CheckmarkOutline,
  Activity,
  WarningAlt,
  Analytics,
} from '@carbon/icons-react';

const navigationItems = [
  { href: '/dashboard',       label: 'Dashboard',       icon: Dashboard },
  { href: '/approvals',       label: 'Gap Approvals',    icon: CheckmarkOutline },
  { href: '/gap-analytics',   label: 'Gap Analytics',    icon: Analytics },
  { href: '/live-journeys',   label: 'Live Journeys',    icon: Activity },
  { href: '/delayed-trains',  label: 'Delayed Trains',   icon: WarningAlt },
  { href: '/train-view',      label: 'Train View',       icon: Train },
  { href: '/location-view',   label: 'Location View',    icon: Location },
  { href: '/settings',        label: 'Settings',         icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      style={{
        width: '260px',
        height: '100vh',
        background: '#ffffff',
        borderRight: '1px solid #e0e0e0',
        position: 'fixed',
        left: 0,
        top: 0,
        display: 'flex',
        flexDirection: 'column',
        zIndex: 1000,
      }}
    >
      {/* Navigation */}
      <nav style={{ flex: 1, padding: '1rem 0', paddingTop: '4.5rem', overflowY: 'auto' }}>
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '0.75rem 1.5rem',
                color: isActive ? '#0f62fe' : '#525252',
                textDecoration: 'none',
                fontSize: '0.875rem',
                fontWeight: isActive ? '600' : '400',
                background: isActive ? '#e8f4ff' : 'transparent',
                borderLeft: isActive ? '3px solid #0f62fe' : '3px solid transparent',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = '#f4f4f4';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = 'transparent';
                }
              }}
            >
              <Icon size={20} style={{ marginRight: '0.75rem' }} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}


