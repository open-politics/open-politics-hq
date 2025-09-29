import React, { useState } from 'react';

interface MonitoringConfigurationProps {
  enabled: boolean;
  schedule: string;
  targetBundleId?: number;
  targetBundleName?: string;
  onEnabledChange: (enabled: boolean) => void;
  onScheduleChange: (schedule: string) => void;
  onTargetBundleChange: (bundleId?: number, bundleName?: string) => void;
}

const SCHEDULE_PRESETS = [
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Every 12 hours', value: '0 */12 * * *' },
  { label: 'Daily at 9 AM', value: '0 9 * * *' },
  { label: 'Daily at 6 PM', value: '0 18 * * *' },
  { label: 'Weekly on Monday', value: '0 9 * * 1' },
  { label: 'Custom', value: 'custom' }
];

export function MonitoringConfiguration({
  enabled,
  schedule,
  targetBundleId,
  targetBundleName,
  onEnabledChange,
  onScheduleChange,
  onTargetBundleChange
}: MonitoringConfigurationProps) {
  const [customSchedule, setCustomSchedule] = useState('');
  const [bundleDestination, setBundleDestination] = useState<'existing' | 'new'>('existing');

  const handleSchedulePresetChange = (presetValue: string) => {
    if (presetValue === 'custom') {
      onScheduleChange(customSchedule);
    } else {
      onScheduleChange(presetValue);
    }
  };

  const handleCustomScheduleChange = (value: string) => {
    setCustomSchedule(value);
    onScheduleChange(value);
  };

  const handleBundleDestinationChange = (destination: 'existing' | 'new') => {
    setBundleDestination(destination);
    if (destination === 'new') {
      onTargetBundleChange(undefined, '');
    } else {
      onTargetBundleChange(undefined, undefined);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900">Monitoring & Automation</h3>
        <p className="text-sm text-gray-500">Configure automatic monitoring and content ingestion</p>
      </div>

      {/* Enable Monitoring Toggle */}
      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
        <div>
          <h4 className="text-sm font-medium text-gray-900">Enable Monitoring</h4>
          <p className="text-sm text-gray-500">Automatically check for new content on a schedule</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onEnabledChange(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
        </label>
      </div>

      {enabled && (
        <div className="space-y-4">
          {/* Schedule Configuration */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">
              Monitoring Schedule
            </label>
            <div className="grid grid-cols-2 gap-2">
              {SCHEDULE_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  onClick={() => handleSchedulePresetChange(preset.value)}
                  className={`px-3 py-2 text-sm border rounded-md text-left ${
                    schedule === preset.value || (preset.value === 'custom' && !SCHEDULE_PRESETS.some(p => p.value === schedule))
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            
            {(!SCHEDULE_PRESETS.some(p => p.value === schedule) || schedule === customSchedule) && (
              <div className="mt-3">
                <input
                  type="text"
                  value={customSchedule}
                  onChange={(e) => handleCustomScheduleChange(e.target.value)}
                  placeholder="0 */6 * * * (cron expression)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Enter a cron expression for custom scheduling
                </p>
              </div>
            )}
          </div>

          {/* Bundle Destination */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">
              Content Destination
            </label>
            <div className="space-y-2">
              <label className="flex items-center">
                <input
                  type="radio"
                  name="bundleDestination"
                  value="existing"
                  checked={bundleDestination === 'existing'}
                  onChange={() => handleBundleDestinationChange('existing')}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                />
                <span className="ml-2 text-sm text-gray-700">Add to existing bundle</span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  name="bundleDestination"
                  value="new"
                  checked={bundleDestination === 'new'}
                  onChange={() => handleBundleDestinationChange('new')}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                />
                <span className="ml-2 text-sm text-gray-700">Create new bundle</span>
              </label>
            </div>

            {bundleDestination === 'existing' && (
              <div>
                <select
                  value={targetBundleId || ''}
                  onChange={(e) => onTargetBundleChange(Number(e.target.value), undefined)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select a bundle...</option>
                  {/* TODO: Load bundles from API */}
                </select>
              </div>
            )}

            {bundleDestination === 'new' && (
              <div>
                <input
                  type="text"
                  value={targetBundleName || ''}
                  onChange={(e) => onTargetBundleChange(undefined, e.target.value)}
                  placeholder="Enter bundle name..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}



