'use client';

import { usePathname } from 'next/navigation';
import {
  Header,
  HeaderName,
  HeaderNavigation,
  HeaderMenuItem,
  HeaderGlobalBar,
  HeaderGlobalAction,
  SkipToContent,
} from '@carbon/react';
import { Notification, UserAvatar, Search } from '@carbon/icons-react';

export default function AppHeader() {
  const pathname = usePathname();
  
  return (
    <Header aria-label="Network Rail Gap Detection">
      <SkipToContent />
      <HeaderName href="/" prefix="Network Rail">
        Gap Detection
      </HeaderName>
      <HeaderNavigation aria-label="Network Rail Gap Detection">
        <HeaderMenuItem href="/live-tracking" isCurrentPage={pathname === '/live-tracking'}>
          Live Tracking
        </HeaderMenuItem>
        <HeaderMenuItem href="/gaps-dashboard" isCurrentPage={pathname === '/gaps-dashboard'}>
          Gap Dashboard
        </HeaderMenuItem>
        <HeaderMenuItem href="/movements" isCurrentPage={pathname === '/movements'}>
          Train Movements
        </HeaderMenuItem>
        <HeaderMenuItem href="/system-status" isCurrentPage={pathname === '/system-status'}>
          System Status
        </HeaderMenuItem>
      </HeaderNavigation>
      <HeaderGlobalBar>
        <HeaderGlobalAction
          aria-label="Search"
          tooltipAlignment="end"
        >
          <Search size={20} />
        </HeaderGlobalAction>
        <HeaderGlobalAction
          aria-label="Notifications"
          tooltipAlignment="end"
        >
          <Notification size={20} />
        </HeaderGlobalAction>
        <HeaderGlobalAction
          aria-label="User Avatar"
          tooltipAlignment="end"
        >
          <UserAvatar size={20} />
        </HeaderGlobalAction>
      </HeaderGlobalBar>
    </Header>
  );
}


