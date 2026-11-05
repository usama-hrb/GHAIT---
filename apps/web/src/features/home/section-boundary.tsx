'use client';

import { Component, type ReactNode } from 'react';
import { ErrorState } from '@/shared/brand';

/**
 * One section of the Home failing (a record that cannot be read) leaves the other sections as
 * they were: it says so in its own place and can be tried again.
 */
export class SectionBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <ErrorState
        titleAs="p"
        className="py-6"
        onRetry={() => {
          this.setState({ failed: false });
        }}
      />
    );
  }
}
