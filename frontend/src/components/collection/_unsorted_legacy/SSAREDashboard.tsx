import React from 'react';

const OPOLDashboard: React.FC = () => {
  return (
    <div className="w-full h-screen">
      <iframe
        src="api/v1/locations/dashboard"
        className="w-full h-full border-none"
        title="opol Dashboard"
        sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
      />
    </div>
  );
};

export default OPOLDashboard;