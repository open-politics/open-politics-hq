import React from 'react';
import Image from 'next/image';

const SpinningBrainLoader = () => {
  return (
    <div className="flex justify-center items-center bg-transparent m-0">
      <Image
        src="/animations/brain.gif"
        alt="Loading..."
        width={50}
        height={50}
        priority={true}
      />
    </div>
  );
};

export default SpinningBrainLoader;