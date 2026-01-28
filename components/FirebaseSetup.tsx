import React from 'react';

// This component is deprecated and no longer used in the application flow.
// Configuration is now hardcoded in services/firebase.ts for the app release.
export const FirebaseSetup: React.FC = () => {
    return (
        <div className="min-h-screen bg-dark text-white flex items-center justify-center p-6">
            <div className="text-center">
                <h1 className="text-xl font-bold mb-2">Configuration Loaded</h1>
                <p className="text-gray-400">The application is using the internal configuration.</p>
            </div>
        </div>
    );
};