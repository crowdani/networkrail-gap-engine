'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  SideNav,
  SideNavItems,
  SideNavLink,
  SideNavDivider,
} from '@carbon/react';
import {
  Train,
  DataView,
  Location,
  Dashboard,
  Network_3,
  ChartNetwork,
  TimePlot,
  WatsonxAi,
} from '@carbon/icons-react';

const NAV = [
  { href: '/dashboard',       label: 'Dashboard',           icon: Dashboard,    desc: 'Pipeline overview'           },
  { href: '/live-journeys',   label: 'Live Journeys',        icon: DataView,     desc: 'LIVE_JOURNEY_STATE'          },
  { href: '/ksql-journeys',   label: 'Completed Journeys',   icon: Train,        desc: 'COMPLETED_JOURNEYS'          },
  { href: '/ksql-gaps',       label: 'Journey Gaps',         icon: ChartNetwork, desc: 'NR_JOURNEY_GAPS'             },
  { href: '/predicted-gaps',  label: 'Predicted Gap Infill', icon: TimePlot,     desc: 'NR_JOURNEY_GAPS_PREDICTED'   },
  { href: '/analysed-gaps',   label: 'AI Delay Analysis',    icon: WatsonxAi,    desc: 'NR_JOURNEY_GAPS_ANALYSED'    },
  { href: '/station-gaps',    label: 'Station Hotspots',     icon: Location,         desc: 'Missed read analysis'        },
  { href: '/pipeline',        label: 'Pipeline Status',      icon: Network_3,        desc: 'ksqlDB queries & topics'     },
];

export default function Sidebar() {
  const path = usePathname();

  return (
    <SideNav
      isFixedNav
      expanded
      isChildOfHeader={false}
      aria-label="Side navigation"
      style={{ borderRight: '1px solid #393939' }}
    >
      {/* Product identity header */}
      <div style={{
        height: 48,
        padding: '0 1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.625rem',
        borderBottom: '1px solid #393939',
        flexShrink: 0,
        background: '#161616',
      }}>
        <div style={{
          width: 20, height: 20,
          background: '#0f62fe',
          borderRadius: 2,
          flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Train size={12} color="#ffffff" />
        </div>
        <div>
          <div style={{ color: '#ffffff', fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.2 }}>
            Network Gap Infill
          </div>
          <div style={{ color: '#6f6f6f', fontSize: '0.65rem', lineHeight: 1.2 }}>
            Network Rail · OpenShift
          </div>
        </div>
      </div>

      <SideNavItems>
        {NAV.map(({ href, label, icon: Icon, desc }) => {
          const active = path === href || (href !== '/' && path.startsWith(href + '/'));
          return (
            <SideNavLink
              key={href}
              href={href}
              isActive={active}
              renderIcon={Icon}
              element={Link}
            >
              <span>{label}</span>
              <span style={{
                display: 'block',
                fontSize: '0.625rem',
                fontFamily: "'IBM Plex Mono', monospace",
                color: active ? '#a8c8ff' : '#6f6f6f',
                marginTop: '0.1rem',
                lineHeight: 1,
              }}>
                {desc}
              </span>
            </SideNavLink>
          );
        })}

        <SideNavDivider />
      </SideNavItems>

      {/* Footer */}
      <div style={{
        padding: '0.75rem 1rem',
        borderTop: '1px solid #393939',
        color: '#6f6f6f',
        fontSize: '0.6875rem',
        flexShrink: 0,
        background: '#161616',
        marginTop: 'auto',
      }}>
        Confluent Platform · ksqlDB 8.3
      </div>
    </SideNav>
  );
}
