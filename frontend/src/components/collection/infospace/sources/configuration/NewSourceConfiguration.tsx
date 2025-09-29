import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { $SourceCreateRequest as SourceCreateRequest } from '@/client/schemas';
import { useSourceStore } from '@/zustand_stores/storeSources';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { Loader2 } from 'lucide-react';
