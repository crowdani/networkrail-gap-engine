'use client';

import { Search, Notification, UserAvatar, Logout } from '@carbon/icons-react';
import { useSession, signOut } from 'next-auth/react';
import { useState } from 'react';
import RefreshCountdown from './RefreshCountdown';
import { useRefresh } from '@/contexts/RefreshContext';

export default function TopHeader() {
  const { data: session } = useSession();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const { isRefreshing, currentStep, totalSteps, completeRefresh } = useRefresh();
  return (
    <header
      style={{
        height: '60px',
        background: '#ffffff',
        borderBottom: '1px solid #e0e0e0',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 2rem',
        zIndex: 1001,
        fontFamily: '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Left side - Title */}
      <h1
        style={{
          fontSize: '0.875rem',
          fontWeight: '600',
          color: '#161616',
          margin: 0,
          marginLeft: '-15px',
          letterSpacing: '0.16px',
          paddingLeft: '0.5rem',
          textAlign: 'left',
        }}
      >
        Network Rail Gap Detection
      </h1>

      {/* Right side - Icons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        {/* Search Icon */}
        <button
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '0.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '4px',
            transition: 'background 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#f4f4f4';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
          aria-label="Search"
        >
          <Search size={20} style={{ color: '#525252' }} />
        </button>

        {/* Notification Icon */}
        <button
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '0.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '4px',
            transition: 'background 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#f4f4f4';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
          aria-label="Notifications"
        >
          <Notification size={20} style={{ color: '#525252' }} />
        </button>

        {/* User Avatar Icon with Dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '0.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '4px',
              transition: 'background 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#f4f4f4';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
            onClick={() => setShowUserMenu(!showUserMenu)}
            aria-label="User profile"
          >
            <UserAvatar size={20} style={{ color: '#525252' }} />
          </button>

          {/* User Dropdown Menu */}
          {showUserMenu && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: '0.5rem',
                background: 'white',
                border: '1px solid #e0e0e0',
                borderRadius: '4px',
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.1)',
                minWidth: '200px',
                zIndex: 1000,
              }}
            >
              <div
                style={{
                  padding: '1rem',
                  borderBottom: '1px solid #e0e0e0',
                }}
              >
                <div style={{ fontSize: '0.875rem', fontWeight: '600', color: '#161616' }}>
                  {session?.user?.name || session?.user?.email || 'User'}
                </div>
                {session?.user?.email && (
                  <div style={{ fontSize: '0.75rem', color: '#525252', marginTop: '0.25rem' }}>
                    {session.user.email}
                  </div>
                )}
              </div>
              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                style={{
                  width: '100%',
                  padding: '0.75rem 1rem',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: '0.875rem',
                  color: '#161616',
                  transition: 'background 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#f4f4f4';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <Logout size={16} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Refresh Countdown Spinner */}
      <RefreshCountdown
        isRefreshing={isRefreshing}
        currentStep={currentStep}
        totalSteps={totalSteps}
        onComplete={completeRefresh}
      />
    </header>
  );
}


