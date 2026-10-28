'use client';

import { useState, useEffect } from 'react';
import { ChevronRight, WarningAlt, Checkmark, Time, ChartLine, Analytics, ArrowRight, Information } from '@carbon/icons-react';

interface Insight {
  id: string;
  type: 'trend' | 'anomaly' | 'prediction' | 'recommendation';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  confidence: number;
  impact: string;
  timestamp: string;
  metrics?: {
    label: string;
    value: string;
    change?: number;
  }[];
  relatedLocations?: string[];
  relatedTrains?: string[];
  actionable?: boolean;
}

interface AnalyticsMetric {
  label: string;
  value: string;
  trend: 'up' | 'down' | 'stable';
  change: string;
  sparkline: number[];
  description: string;
}

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [selectedInsight, setSelectedInsight] = useState<Insight | null>(null);
  const [metrics, setMetrics] = useState<AnalyticsMetric[]>([]);
  const [timeRange, setTimeRange] = useState('7d');
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [timeRange]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Fetch metrics
      const metricsResponse = await fetch(`/api/analytics/metrics?timeRange=${timeRange}`);
      if (!metricsResponse.ok) {
        throw new Error('Failed to fetch metrics');
      }
      const metricsData = await metricsResponse.json();
      setMetrics(metricsData.metrics || []);

      // Fetch insights
      const insightsResponse = await fetch(`/api/analytics/insights?timeRange=${timeRange}`);
      if (!insightsResponse.ok) {
        throw new Error('Failed to fetch insights');
      }
      const insightsData = await insightsResponse.json();
      setInsights(insightsData.insights || []);
      
    } catch (err) {
      console.error('Error loading analytics data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load analytics data');
    } finally {
      setLoading(false);
    }
  };

  const analyseData = async () => {
    setAnalyzing(true);
    setAnalysisProgress(0);
    setError(null);
    
    try {
      // Trigger analysis
      const response = await fetch('/api/analytics/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeRange })
      });
      
      if (!response.ok) {
        throw new Error('Failed to trigger analysis');
      }
      
      // Simulate progress while waiting
      let progress = 0;
      const interval = setInterval(() => {
        progress += 10;
        setAnalysisProgress(progress);
        if (progress >= 90) {
          clearInterval(interval);
        }
      }, 500);
      
      // Wait for analysis to complete
      await new Promise(resolve => setTimeout(resolve, 5000));
      clearInterval(interval);
      setAnalysisProgress(100);
      
      // Reload data
      await loadData();
      
    } catch (err) {
      console.error('Error running analysis:', err);
      setError(err instanceof Error ? err.message : 'Failed to run analysis');
    } finally {
      setAnalyzing(false);
      setAnalysisProgress(0);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return '#da1e28';
      case 'high': return '#ff832b';
      case 'medium': return '#f1c21b';
      case 'low': return '#0f62fe';
      case 'info': return '#24a148';
      default: return '#525252';
    }
  };

  const getSeverityBg = (severity: string) => {
    switch (severity) {
      case 'critical': return 'rgba(218, 30, 40, 0.1)';
      case 'high': return 'rgba(255, 131, 43, 0.1)';
      case 'medium': return 'rgba(241, 194, 27, 0.1)';
      case 'low': return 'rgba(15, 98, 254, 0.1)';
      case 'info': return 'rgba(36, 161, 72, 0.1)';
      default: return 'rgba(82, 82, 82, 0.1)';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'trend': return <ChartLine size={20} />;
      case 'anomaly': return <WarningAlt size={20} />;
      case 'prediction': return <Time size={20} />;
      case 'recommendation': return <Checkmark size={20} />;
      default: return <Analytics size={20} />;
    }
  };

  const renderSparkline = (data: number[], color: string = '#0f62fe') => {
    if (!data || data.length === 0) return null;
    
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    const width = 100;
    const height = 40;
    
    const points = data.map((value, index) => {
      const x = (index / (data.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    }).join(' ');

    const areaPoints = `0,${height} ${points} ${width},${height}`;

    return (
      <svg width={width} height={height} style={{ display: 'block' }}>
        <defs>
          <linearGradient id={`gradient-${color}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0.05" />
          </linearGradient>
        </defs>
        <polygon
          points={areaPoints}
          fill={`url(#gradient-${color})`}
        />
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {data.map((value, index) => {
          const x = (index / (data.length - 1)) * width;
          const y = height - ((value - min) / range) * height;
          return (
            <circle
              key={index}
              cx={x}
              cy={y}
              r="2.5"
              fill={color}
            />
          );
        })}
      </svg>
    );
  };

  if (loading) {
    return (
      <div style={{ 
        padding: '2rem', 
        background: 'linear-gradient(180deg, #f4f4f4 0%, #ffffff 100%)', 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center' 
      }}>
        <div style={{ textAlign: 'center', maxWidth: '400px' }}>
          <div style={{ marginBottom: '2rem' }}>
            <Analytics size={64} style={{ color: '#0f62fe' }} />
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: '300', color: '#161616', marginBottom: '1rem', fontFamily: 'IBM Plex Sans, system-ui, -apple-system, sans-serif' }}>
            Loading AI Analytics
          </div>
          <div style={{ fontSize: '0.875rem', color: '#525252', marginBottom: '2rem', fontFamily: 'IBM Plex Sans, system-ui, -apple-system, sans-serif' }}>
            Fetching insights and metrics...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ 
      background: 'linear-gradient(180deg, #f4f4f4 0%, #ffffff 50%)', 
      minHeight: '100vh', 
      fontFamily: 'IBM Plex Sans, system-ui, -apple-system, sans-serif' 
    }}>
      {/* Carbon-style Header */}
      <div style={{
        background: '#ffffff',
        borderBottom: '1px solid #e0e0e0',
        padding: '2rem'
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{
                width: '48px',
                height: '48px',
                background: '#0f62fe',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <Analytics size={28} style={{ color: '#ffffff' }} />
              </div>
              <div>
                <h1 style={{ fontSize: '2rem', fontWeight: '400', margin: 0, color: '#161616', lineHeight: 1.25 }}>
                  AI-Powered Analytics
                </h1>
                <div style={{ fontSize: '0.875rem', color: '#525252', marginTop: '0.25rem', lineHeight: 1.29 }}>
                  Railway Operations Optimisation
                </div>
              </div>
            </div>
            <div style={{
              padding: '0.5rem 1rem',
              background: '#f4f4f4',
              border: '1px solid #e0e0e0',
              fontSize: '0.875rem',
              color: '#161616',
              fontWeight: '400'
            }}>
              Powered by <strong>watsonx.ai</strong>
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '2rem' }}>
        {/* Error Display */}
        {error && (
          <div style={{
            background: '#fff1f1',
            border: '1px solid #da1e28',
            borderLeft: '4px solid #da1e28',
            padding: '1rem 1.5rem',
            marginBottom: '2rem',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem'
          }}>
            <WarningAlt size={24} style={{ color: '#da1e28', flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: '0.875rem', fontWeight: '600', color: '#161616', marginBottom: '0.25rem' }}>
                Error Loading Analytics
              </div>
              <div style={{ fontSize: '0.875rem', color: '#525252' }}>
                {error}
              </div>
            </div>
          </div>
        )}

        {/* Carbon Controls Bar */}
        <div style={{
          display: 'flex',
          gap: '1rem',
          marginBottom: '2rem',
          alignItems: 'flex-end',
          background: '#ffffff',
          padding: '1.5rem',
          border: '1px solid #e0e0e0'
        }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: '0.75rem', color: '#525252', marginBottom: '0.5rem', fontWeight: '400', lineHeight: 1.34 }}>
              Analysis Period
            </label>
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              style={{
                padding: '0.6875rem 1rem',
                border: 'none',
                borderBottom: '1px solid #8d8d8d',
                fontSize: '0.875rem',
                lineHeight: 1.29,
                background: '#ffffff',
                fontFamily: 'IBM Plex Sans, system-ui, -apple-system, sans-serif',
                cursor: 'pointer',
                minWidth: '200px',
                outline: 'none'
              }}
            >
              <option value="24h">Last 24 Hours</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
              <option value="90d">Last 90 Days</option>
            </select>
          </div>

          <button
            onClick={analyseData}
            disabled={analyzing}
            style={{
              padding: '0.875rem 1.5rem',
              fontSize: '0.875rem',
              lineHeight: 1.29,
              fontWeight: '400',
              background: analyzing ? '#8d8d8d' : '#0f62fe',
              color: '#ffffff',
              border: 'none',
              cursor: analyzing ? 'not-allowed' : 'pointer',
              fontFamily: 'IBM Plex Sans, system-ui, -apple-system, sans-serif',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              transition: 'background 0.11s cubic-bezier(0.2, 0, 0.38, 0.9)'
            }}
            onMouseEnter={(e) => {
              if (!analyzing) e.currentTarget.style.background = '#0353e9';
            }}
            onMouseLeave={(e) => {
              if (!analyzing) e.currentTarget.style.background = '#0f62fe';
            }}
          >
            <Analytics size={16} />
            {analyzing ? 'Analysing...' : 'Run Analysis'}
          </button>
        </div>

        {/* Analysis Progress */}
        {analyzing && (
          <div style={{
            background: '#ffffff',
            border: '1px solid #0f62fe',
            padding: '1rem 1.5rem',
            marginBottom: '2rem',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem'
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.875rem', color: '#161616', marginBottom: '0.5rem', fontWeight: '600' }}>
                Running AI Analysis...
              </div>
              <div style={{ width: '100%', height: '6px', background: '#e0e0e0', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{
                  width: `${analysisProgress}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #0f62fe 0%, #0043ce 100%)',
                  transition: 'width 0.3s ease'
                }} />
              </div>
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: '600', color: '#0f62fe', fontFamily: 'IBM Plex Mono, monospace', minWidth: '60px', textAlign: 'right' }}>
              {analysisProgress}%
            </div>
          </div>
        )}

        {/* Premium Metrics Grid */}
        {metrics.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem', marginBottom: '3rem' }}>
            {metrics.map((metric, index) => (
              <div
                key={index}
                style={{
                  background: '#ffffff',
                  padding: '2rem',
                  border: '1px solid #e0e0e0',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  cursor: 'pointer',
                  position: 'relative',
                  overflow: 'hidden',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-4px)';
                  e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)';
                  e.currentTarget.style.borderColor = '#0f62fe';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
                  e.currentTarget.style.borderColor = '#e0e0e0';
                }}
              >
                <div style={{ marginBottom: '1.5rem' }}>
                  <div style={{ fontSize: '0.75rem', color: '#525252', marginBottom: '0.75rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {metric.label}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem', marginBottom: '0.5rem' }}>
                    <div style={{ fontSize: '2.5rem', fontWeight: '300', color: '#161616', lineHeight: 1 }}>
                      {metric.value}
                    </div>
                    <div style={{ 
                      fontSize: '1rem', 
                      fontWeight: '600',
                      color: metric.trend === 'down' && metric.label.toLowerCase().includes('gap') ? '#24a148' : metric.trend === 'up' && !metric.label.toLowerCase().includes('accuracy') ? '#da1e28' : '#24a148',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem'
                    }}>
                      {metric.change}
                    </div>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#525252', lineHeight: 1.5 }}>
                    {metric.description}
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  {renderSparkline(metric.sparkline, metric.trend === 'down' && metric.label.toLowerCase().includes('gap') ? '#24a148' : metric.trend === 'up' && !metric.label.toLowerCase().includes('accuracy') ? '#da1e28' : '#0f62fe')}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* No Metrics Message */}
        {metrics.length === 0 && !loading && (
          <div style={{
            background: '#ffffff',
            border: '1px solid #e0e0e0',
            padding: '3rem',
            textAlign: 'center',
            marginBottom: '3rem'
          }}>
            <Information size={48} style={{ color: '#525252', marginBottom: '1rem' }} />
            <div style={{ fontSize: '1.25rem', color: '#161616', marginBottom: '0.5rem', fontWeight: '400' }}>
              No Metrics Available
            </div>
            <div style={{ fontSize: '0.875rem', color: '#525252' }}>
              Run an analysis to generate metrics for the selected time period
            </div>
          </div>
        )}

        {/* Carbon AI Insights Section */}
        <div style={{ marginBottom: '3rem' }}>
          <div style={{
            background: '#ffffff',
            border: '1px solid #e0e0e0',
            borderBottom: 'none'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '1rem 1.5rem',
              borderBottom: '1px solid #e0e0e0'
            }}>
              <h2 style={{
                fontSize: '1.25rem',
                fontWeight: '600',
                color: '#161616',
                margin: 0,
                lineHeight: 1.4
              }}>
                AI-Generated Insights
              </h2>
              <div style={{
                fontSize: '0.75rem',
                color: '#525252',
                lineHeight: 1.34,
                padding: '0.25rem 0.5rem',
                background: '#f4f4f4',
                fontWeight: '400'
              }}>
                {insights.length} {insights.length === 1 ? 'insight' : 'insights'}
              </div>
            </div>

            {insights.length > 0 ? (
              <div>
                {insights.map((insight, index) => (
                  <div
                    key={insight.id}
                    onClick={() => setSelectedInsight(insight)}
                    style={{
                      background: '#ffffff',
                      borderBottom: index < insights.length - 1 ? '1px solid #e0e0e0' : 'none',
                      padding: '1.5rem',
                      cursor: 'pointer',
                      transition: 'background 0.11s cubic-bezier(0.2, 0, 0.38, 0.9)',
                      position: 'relative'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#f4f4f4';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#ffffff';
                    }}
                  >
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                      {/* Carbon-style Icon Container */}
                      <div style={{
                        width: '32px',
                        height: '32px',
                        background: getSeverityBg(insight.severity),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: getSeverityColor(insight.severity),
                        flexShrink: 0,
                        marginTop: '0.25rem'
                      }}>
                        {getTypeIcon(insight.type)}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* Carbon Tags Row */}
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                          <span style={{
                            fontSize: '0.75rem',
                            padding: '0 0.5rem',
                            height: '1.5rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            background: getSeverityBg(insight.severity),
                            color: getSeverityColor(insight.severity),
                            textTransform: 'capitalize',
                            fontWeight: '400',
                            lineHeight: 1.34
                          }}>
                            {insight.type}
                          </span>
                          <span style={{
                            fontSize: '0.75rem',
                            padding: '0 0.5rem',
                            height: '1.5rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            background: getSeverityBg(insight.severity),
                            color: getSeverityColor(insight.severity),
                            fontWeight: '400',
                            lineHeight: 1.34
                          }}>
                            {insight.severity}
                          </span>
                          <span style={{
                            fontSize: '0.75rem',
                            padding: '0 0.5rem',
                            height: '1.5rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            background: '#e0e0e0',
                            color: '#161616',
                            fontWeight: '400',
                            lineHeight: 1.34
                          }}>
                            {insight.confidence}% confidence
                          </span>
                          {insight.actionable && (
                            <span style={{
                              fontSize: '0.75rem',
                              padding: '0 0.5rem',
                              height: '1.5rem',
                              display: 'inline-flex',
                              alignItems: 'center',
                              background: 'rgba(36, 161, 72, 0.1)',
                              color: '#24a148',
                              fontWeight: '400',
                              lineHeight: 1.34
                            }}>
                              Actionable
                            </span>
                          )}
                        </div>

                        {/* Title */}
                        <h3 style={{
                          fontSize: '1rem',
                          fontWeight: '600',
                          color: '#161616',
                          margin: '0 0 0.5rem 0',
                          lineHeight: 1.375
                        }}>
                          {insight.title}
                        </h3>

                        {/* Description */}
                        <p style={{
                          fontSize: '0.875rem',
                          color: '#525252',
                          margin: '0 0 1rem 0',
                          lineHeight: 1.43
                        }}>
                          {insight.description}
                        </p>

                        {/* Metrics Grid - Carbon Structured List Style */}
                        {insight.metrics && insight.metrics.length > 0 && (
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                            gap: '1px',
                            marginBottom: '1rem',
                            background: '#e0e0e0',
                            border: '1px solid #e0e0e0'
                          }}>
                            {insight.metrics.map((metric, idx) => (
                              <div
                                key={idx}
                                style={{
                                  padding: '0.75rem 1rem',
                                  background: '#f4f4f4'
                                }}
                              >
                                <div style={{
                                  fontSize: '0.75rem',
                                  color: '#525252',
                                  marginBottom: '0.25rem',
                                  fontWeight: '400',
                                  lineHeight: 1.34
                                }}>
                                  {metric.label}
                                </div>
                                <div style={{
                                  fontSize: '1.25rem',
                                  fontWeight: '400',
                                  color: '#161616',
                                  lineHeight: 1.4
                                }}>
                                  {metric.value}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Footer Info - Carbon Detail Style */}
                        <div style={{
                          display: 'flex',
                          gap: '1.5rem',
                          fontSize: '0.75rem',
                          color: '#525252',
                          paddingTop: '0.75rem',
                          borderTop: '1px solid #e0e0e0',
                          lineHeight: 1.34
                        }}>
                          <div>
                            <span style={{ color: '#161616', fontWeight: '400' }}>Impact: </span>
                            {insight.impact}
                          </div>
                          <div>
                            <span style={{ color: '#161616', fontWeight: '400' }}>Detected: </span>
                            {new Date(insight.timestamp).toLocaleString('en-GB', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Carbon Chevron */}
                      <ChevronRight
                        size={16}
                        style={{
                          color: '#525252',
                          flexShrink: 0,
                          marginTop: '0.5rem'
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{
                padding: '3rem 1.5rem',
                textAlign: 'center'
              }}>
                <Information size={48} style={{ color: '#525252', marginBottom: '1rem' }} />
                <div style={{
                  fontSize: '1rem',
                  color: '#161616',
                  marginBottom: '0.5rem',
                  fontWeight: '400',
                  lineHeight: 1.375
                }}>
                  No insights available
                </div>
                <div style={{
                  fontSize: '0.875rem',
                  color: '#525252',
                  marginBottom: '1.5rem',
                  lineHeight: 1.43
                }}>
                  Run an analysis to generate AI-powered insights for the selected time period
                </div>
                <button
                  onClick={analyseData}
                  disabled={analyzing}
                  style={{
                    padding: '0.875rem 1rem 0.875rem 0.75rem',
                    fontSize: '0.875rem',
                    lineHeight: 1.29,
                    fontWeight: '400',
                    background: analyzing ? '#8d8d8d' : '#0f62fe',
                    color: '#ffffff',
                    border: 'none',
                    cursor: analyzing ? 'not-allowed' : 'pointer',
                    fontFamily: 'IBM Plex Sans, system-ui, -apple-system, sans-serif',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    transition: 'background 0.11s cubic-bezier(0.2, 0, 0.38, 0.9)'
                  }}
                  onMouseEnter={(e) => {
                    if (!analyzing) e.currentTarget.style.background = '#0353e9';
                  }}
                  onMouseLeave={(e) => {
                    if (!analyzing) e.currentTarget.style.background = '#0f62fe';
                  }}
                >
                  <Analytics size={16} />
                  Run analysis now
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


