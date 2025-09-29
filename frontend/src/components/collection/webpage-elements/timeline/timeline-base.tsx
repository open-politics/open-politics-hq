'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';
import { motion, HTMLMotionProps } from 'framer-motion';
import { AlertCircle, Loader2, ExternalLink, LinkIcon } from 'lucide-react';
import type { TimelineColor } from '@/lib/types/timeline';
import { ReactNode } from 'react';
const timelineVariants = cva('flex flex-col relative', {
  variants: {
    size: {
      sm: 'gap-4',
      md: 'gap-6',
      lg: 'gap-8',
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * Timeline component props interface
 * @interface TimelineProps
 * @extends {React.HTMLAttributes<HTMLOListElement>}
 * @extends {VariantProps<typeof timelineVariants>}
 */
interface TimelineProps
  extends React.HTMLAttributes<HTMLOListElement>,
    VariantProps<typeof timelineVariants> {
  /** Size of the timeline icons */
  iconsize?: 'sm' | 'md' | 'lg';
}

/**
 * Timeline component for displaying a vertical list of events or items
 * @component
 */
const Timeline = (
  {
    ref,
    className,
    iconsize,
    size,
    children,
    ...props
  }: TimelineProps & {
    ref: React.RefObject<HTMLOListElement>;
  }
) => {
  const items = React.Children.toArray(children);

  if (items.length === 0) {
    return <TimelineEmpty />;
  }

  return (
    <ol
      ref={ref}
      aria-label="Timeline"
      className={cn(
        timelineVariants({ size }),
        'relative min-h-[600px] w-full max-w-2xl mx-auto py-8',
        className
      )}
      {...props}
    >
      {React.Children.map(children, (child, index) => {
        if (
          React.isValidElement(child) &&
          typeof child.type !== 'string' &&
          'displayName' in child.type &&
          child.type.displayName === 'TimelineItem'
        ) {
          return React.cloneElement(child, {
            iconsize,
            showConnector: index !== items.length - 1,
          } as React.ComponentProps<typeof TimelineItem>);
        }
        return child;
      })}
    </ol>
  );
};
Timeline.displayName = 'Timeline';

/**
 * TimelineItem component props interface
 * @interface TimelineItemProps
 * @extends {Omit<HTMLMotionProps<"li">, "ref">}
 */
interface TimelineItemProps extends Omit<HTMLMotionProps<'li'>, 'ref'> {
  /** Date string for the timeline item */
  date?: string;
  /** Title of the timeline item */
  title?: string;
  /** Description text */
  description?: string;
  /** Link to the timeline item */
  link?: string;
  /** Custom icon element */
  icon?: React.ReactNode;
  /** Color theme for the icon */
  iconColor?: TimelineColor;
  /** Current status of the item */
  status?: 'completed' | 'in-progress' | 'pending';
  /** Color theme for the connector line */
  connectorColor?: TimelineColor;
  /** Whether to show the connector line */
  showConnector?: boolean;
  /** Size of the icon */
  iconsize?: 'sm' | 'md' | 'lg';
  /** Loading state */
  loading?: boolean;
  /** Error message */
  error?: string;
  /** Video title */
  videoTitle?: string;
  /** Video description */
  videoDescription?: string | ReactNode;
  /** Video embed link */
  videoEmbedLink?: string;
  /** Color theme for the item */
  color?: TimelineColor;
}

const TimelineItem = (
  {
    ref,
    className,
    date,
    title,
    description,
    link,
    icon,
    iconColor,
    status = 'completed',
    connectorColor,
    showConnector = true,
    iconsize,
    loading,
    error,
    videoEmbedLink,
    videoTitle,
    videoDescription,
    color,

    // Omit unused Framer Motion props
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    initial,

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    animate,

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    transition,

    ...props
  }: TimelineItemProps & {
    ref: React.RefObject<HTMLLIElement>;
  }
) => {
  const commonClassName = cn(
    'relative w-full mb-8 last:mb-0',
    className,
  );

  // Loading State
  if (loading) {
    return (
      <motion.li
        ref={ref}
        className={commonClassName}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        role="status"
        {...props}
      >
        <div className="grid grid-cols-[minmax(auto,8rem)_auto_1fr] items-start px-4">
          <div className="pr-4 text-right">
            <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          </div>

          <div className="mx-3 flex flex-col items-center justify-start gap-y-2">
            <div className="relative flex h-8 w-8 animate-pulse items-center justify-center rounded-full bg-muted ring-8 ring-background">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
            {showConnector && <div className="h-full w-0.5 animate-pulse bg-muted" />}
          </div>

          <div className="flex flex-col gap-2 pl-2">
            <div className="space-y-2">
              <div className="h-4 w-24 animate-pulse rounded bg-muted" />
              <div className="h-3 w-48 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
      </motion.li>
    );
  }

  // Error State
  if (error) {
    return (
      <motion.li
        ref={ref}
        className={cn(commonClassName, 'border border-destructive/50 bg-destructive/10')}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        role="alert"
        {...props}
      >
        <div className="grid grid-cols-[minmax(auto,8rem)_auto_1fr] items-start px-4">
          <div className="pr-4 text-right">
            <TimelineTime className="text-destructive">{date}</TimelineTime>
          </div>

          <div className="mx-3 flex flex-col items-center justify-start gap-y-2">
            <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-destructive/20 ring-8 ring-background">
              <AlertCircle className="h-4 w-4 text-destructive" />
            </div>
            {showConnector && <TimelineConnector status="pending" className="h-full" />}
          </div>

          <div className="flex flex-col gap-2 pl-2">
            <TimelineHeader>
              <TimelineTitle className="text-destructive">{title || 'Error'}</TimelineTitle>
            </TimelineHeader>
            <TimelineDescription className="text-destructive">{error}</TimelineDescription>
          </div>
        </div>
      </motion.li>
    );
  }

  const content = (
    <div
      className="grid grid-cols-[0.5fr_auto_1.5fr] gap-4 items-start"
      {...(status === 'in-progress' ? { 'aria-current': 'step' } : {})}
    >
      {/* Date */}
      <div className="flex flex-col justify-start pt-1">
        <TimelineTime className="text-right pr-4">{date}</TimelineTime>
      </div>

      {/* Timeline dot and connector */}
      <div className="flex flex-col items-center">
        <div className="relative z-10">
          <TimelineIcon icon={icon} color={iconColor} status={status} iconSize={iconsize} />
        </div>
        {showConnector && (
          <div className="h-16 w-0.5 bg-border mt-2" />
        )}
      </div>

      {/* Content */}
      <TimelineContent>
        <TimelineHeader>
          <TimelineTitle>{title}</TimelineTitle>
        </TimelineHeader>
        <TimelineDescription>{description}</TimelineDescription>
        
        {/* Regular link for non-video items */}
        {link && !videoEmbedLink && (
          <div className="mt-2">
            <TimelineLink href={link}>
              <span className="whitespace-nowrap">View Resource</span>
            </TimelineLink>
          </div>
        )}

        {/* Video section without separate description */}
        {videoEmbedLink && (
          <TimelineVideo 
            src={videoEmbedLink}
            title={videoTitle}
            description={videoDescription as string}
            link={link}
          />
        )}
      </TimelineContent>
    </div>
  );

  // Filter out Framer Motion specific props
  const {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    style,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onDrag,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onDragStart,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onDragEnd,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onAnimationStart,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onAnimationComplete,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    transformTemplate,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    whileHover,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    whileTap,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    whileDrag,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    whileFocus,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    whileInView,
    ...filteredProps
  } = props;

  return (
    <li ref={ref} className={commonClassName} {...filteredProps}>
      {content}
    </li>
  );
};
TimelineItem.displayName = 'TimelineItem';

interface TimelineTimeProps extends React.HTMLAttributes<HTMLTimeElement> {
  /** Date string, Date object, or timestamp */
  date?: string | Date | number;
  /** Optional format for displaying the date */
  format?: Intl.DateTimeFormatOptions;
}

const defaultDateFormat: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
};

const TimelineTime = (
  {
    ref,
    className,
    date,
    format,
    children,
    ...props
  }: TimelineTimeProps & {
    ref: React.RefObject<HTMLTimeElement>;
  }
) => {
  const formattedDate = React.useMemo(() => {
    if (!date) return '';

    try {
      const dateObj = new Date(date);
      if (isNaN(dateObj.getTime())) return '';

      return new Intl.DateTimeFormat('en-US', {
        ...defaultDateFormat,
        ...format,
      }).format(dateObj);
    } catch (error) {
      console.error('Error formatting date:', error);
      return '';
    }
  }, [date, format]);

  return (
    <time
      ref={ref}
      dateTime={date ? new Date(date).toISOString() : undefined}
      className={cn('text-sm font-medium tracking-tight text-muted-foreground', className)}
      {...props}
    >
      {children || formattedDate}
    </time>
  );
};
TimelineTime.displayName = 'TimelineTime';

const TimelineConnector = (
  {
    ref,
    className,
    status = 'completed',
    color,
    ...props
  }
) => (<div
  ref={ref}
  className={cn(
    'w-0.5',
    {
      'bg-primary': color === 'primary' || (!color && status === 'completed'),
      'bg-muted': color === 'muted' || (!color && status === 'pending'),
      'bg-secondary': color === 'secondary',
      'bg-black': color === 'accent',
      'bg-gradient-to-b from-primary to-muted': !color && status === 'in-progress',
    },
    className,
  )}
  {...props}
/>);
TimelineConnector.displayName = 'TimelineConnector';

const TimelineHeader = (
  {
    ref,
    className,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & {
    ref: React.RefObject<HTMLDivElement>;
  }
) => (<div ref={ref} className={cn('flex items-center gap-4', className)} {...props} />);
TimelineHeader.displayName = 'TimelineHeader';

const TimelineTitle = (
  {
    ref,
    className,
    children,
    ...props
  }: React.HTMLAttributes<HTMLHeadingElement> & {
    ref: React.RefObject<HTMLHeadingElement>;
  }
) => (<h3
  ref={ref}
  className={cn('font-semibold leading-none tracking-tight text-secondary-foreground', className)}
  {...props}
>
  {children}
</h3>);
TimelineTitle.displayName = 'TimelineTitle';

interface TimelineLinkProps extends React.HTMLAttributes<HTMLAnchorElement> {
  href: string;
  children: React.ReactNode;
}

const TimelineLink = (
  {
    ref,
    className,
    href,
    children,
    ...props
  }: TimelineLinkProps & {
    ref: React.RefObject<HTMLAnchorElement>;
  }
) => (<a 
  ref={ref} 
  href={href} 
  className={cn(
    'inline-flex items-center gap-2 text-primary hover:text-primary/80',
    'bg-primary/5 hover:bg-primary/10',
    'px-3 py-1.5 rounded-md transition-colors',
    'text-sm font-medium',
    className
  )} 
  target="_blank"
  rel="noopener noreferrer"
  {...props}
>
  <ExternalLink className="h-4 w-4" />
  {children || 'View Resource'}
</a>);
TimelineLink.displayName = 'TimelineLink';

/**
 * TimelineVideo component props interface
 * @interface TimelineVideoProps
 * @extends {React.HTMLAttributes<HTMLDivElement>}
 */
interface TimelineVideoProps extends React.HTMLAttributes<HTMLDivElement> {
  src: string;
  title?: string;
  description?: string;
  link?: string;
  aspectRatio?: '16:9' | '4:3' | '1:1';
  width?: number;
  height?: number;
}

const TimelineVideo = (
  {
    ref,
    className,
    src,
    title,
    description,
    link,
    aspectRatio = '16:9',
    width = 560,
    height = 315,
    ...props
  }: TimelineVideoProps & {
    ref: React.RefObject<HTMLDivElement>;
  }
) => {
  const isYouTube = src.includes('youtube.com') || src.includes('youtu.be');
  const isVimeo = src.includes('vimeo.com');
  const isOEmbed = src.includes('oembed');
  
  const aspectRatioClass = {
    '16:9': 'aspect-video',
    '4:3': 'aspect-4/3',
    '1:1': 'aspect-square',
  }[aspectRatio];

  return (
    <div ref={ref} className={cn(
      'mt-3 mb-4 overflow-hidden rounded-lg border border-border bg-muted shadow-sm',
      className
    )} {...props}>
      {/* Header with title and button */}
      {(title || link) && (
        <div className="flex items-center justify-between px-3 py-2 bg-background border-b border-border">
          {title && <h4 className="text-sm font-medium">{title}</h4>}
          {link && (
            <a 
              href={link} 
              className="flex items-center gap-1.5 text-primary hover:underline px-2 py-1 rounded-md hover:bg-primary/10 text-sm transition-colors shrink-0" 
              target="_blank" 
              rel="noopener noreferrer"
            >
              <ExternalLink className="h-4 w-4" />
              <span>Watch video</span>
            </a>
          )}
        </div>
      )}

      {/* Video container with aspect ratio */}
      <div className={cn(aspectRatioClass)}>          
        {isYouTube && (
          <iframe
            className="h-full w-full"
            width={width}
            height={height}
            src={src.includes('?') ? src : `${src}?rel=0&showinfo=0`}
            title={title || 'YouTube video player'}
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        )}
        
        {isVimeo && (
          <iframe
            className="h-full w-full"
            width={width}
            height={height}
            src={src.includes('?') ? src : `${src}?title=0&byline=0&portrait=0`}
            title={title || 'Vimeo video player'}
            frameBorder="0"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
          />
        )}
        
        {isOEmbed && (
          <iframe
            className="h-full w-full"
            width={width}
            height={height}
            src={src}
            title={title || 'Embedded content'}
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        )}
        
        {!isYouTube && !isVimeo && !isOEmbed && (
          <video
            className="h-full w-full"
            controls
            width={width}
            height={height}
          >
            <source src={src} />
            Your browser does not support the video tag.
          </video>
        )}
      </div>

      {/* Footer with description only */}
      {description && (
        <div className="border-t border-border bg-background/50">
          <div className="p-3">
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
      )}
    </div>
  );
};
TimelineVideo.displayName = 'TimelineVideo';

const TimelineIcon = ({
  icon,
  color = 'primary',
  status = 'completed',
  iconSize = 'md',
}: {
  icon?: React.ReactNode;
  color?: 'primary' | 'secondary' | 'muted' | 'accent' | 'destructive';
  status?: 'completed' | 'in-progress' | 'pending' | 'error';
  iconSize?: 'sm' | 'md' | 'lg';
}) => {
  const sizeClasses = {
    sm: 'h-8 w-8',
    md: 'h-10 w-10',
    lg: 'h-12 w-12',
  };

  const iconSizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
    lg: 'h-6 w-6',
  };

  const colorClasses = {
    primary: 'bg-primary text-primary-foreground',
    secondary: 'bg-secondary text-secondary-foreground',
    muted: 'bg-muted text-muted-foreground',
    accent: 'bg-accent text-accent-foreground',
    destructive: 'bg-destructive text-destructive-foreground',
  };

  return (
    <div
      className={cn(
        'relative flex items-center justify-center rounded-full ring-8 ring-background shadow-sm',
        sizeClasses[iconSize],
        colorClasses[color],
      )}
    >
      {icon ? (
        <div className={cn('flex items-center justify-center', iconSizeClasses[iconSize])}>
          {icon}
        </div>
      ) : (
        <div className={cn('rounded-full', iconSizeClasses[iconSize])} />
      )}
    </div>
  );
};

const TimelineDescription = (
  {
    ref,
    className,
    ...props
  }: React.HTMLAttributes<HTMLParagraphElement> & {
    ref: React.RefObject<HTMLParagraphElement>;
  }
) => (<p ref={ref} className={cn('max-w-sm text-sm text-muted-foreground', className)} {...props} />);
TimelineDescription.displayName = 'TimelineDescription';

const TimelineContent = (
  {
    ref,
    className,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & {
    ref: React.RefObject<HTMLDivElement>;
  }
) => (<div ref={ref} className={cn('flex flex-col gap-2 pl-2', className)} {...props} />);
TimelineContent.displayName = 'TimelineContent';

const TimelineEmpty = (
  {
    ref,
    className,
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & {
    ref: React.RefObject<HTMLDivElement>;
  }
) => (<div
  ref={ref}
  className={cn('flex flex-col items-center justify-center p-8 text-center', className)}
  {...props}
>
  <p className="text-sm text-muted-foreground">{children || 'No timeline items to display'}</p>
</div>);
TimelineEmpty.displayName = 'TimelineEmpty';

export {
  Timeline,
  TimelineItem,
  TimelineConnector,
  TimelineHeader,
  TimelineTitle,
  TimelineIcon,
  TimelineDescription,
  TimelineContent,
  TimelineTime,
  TimelineEmpty,
  TimelineVideo,
  TimelineLink,
};