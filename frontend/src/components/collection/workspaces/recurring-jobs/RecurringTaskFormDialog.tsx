import React, { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import {
    // Dialog, // No longer need the main Dialog wrapper here
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    // DialogClose, // Import if using a custom close button inside
} from "@/components/ui/dialog";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useDataSourceStore } from '@/zustand_stores/storeDataSources';
import { useClassificationSystem } from '@/hooks/useClassificationSystem';
import * as ClassificationTypes from '@/lib/classification/types';
import { ClassificationSchemeRead } from '@/client'; // Use client type for schemes
import { RecurringTask, RecurringTaskCreate, RecurringTaskUpdate } from '@/zustand_stores/storeRecurringTasks';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';

// --- Zod Schema Definition ---

// Base schema for common fields
const baseSchema = z.object({
  name: z.string().min(1, { message: 'Task name is required.' }),
  description: z.string().optional(),
  schedule: z.string().regex(/^(\*|[0-5]?\d)(\s(\*|([01]?\d|2[0-3])))(\s(\*|([1-9]|[12]\d|3[01])))(\s(\*|(1[0-2]|[1-9])))(\s(\*|[0-6]))$/, {
    message: 'Invalid cron format (e.g., "0 5 * * *" for 5 AM daily).',
  }),
  status: z.enum(['active', 'paused']).default('paused'),
});

// Schema for INGEST type configuration
const ingestConfigSchema = z.object({
  type: z.literal('ingest'),
  config_target_datasource_id: z.number({ required_error: "Target data source is required." }).int().positive().optional().nullable(),
  config_source_urls: z.array(z.string().url({ message: "Please enter valid URLs." })).min(1, { message: "At least one source URL is required." }),
  config_deduplication_strategy: z.enum(['url_hash']).default('url_hash'), // Only 'url_hash' allowed by schema
});

// Schema for CLASSIFY type configuration
const classifyConfigSchema = z.object({
  type: z.literal('classify'),
  config_target_datasource_ids: z.array(z.number()).min(1, { message: 'At least one target data source is required.' }),
  config_target_scheme_ids: z.array(z.number()).min(1, { message: 'At least one classification scheme is required.' }),
  config_process_only_new: z.boolean().default(true),
  config_job_name_template: z.string().optional().default('Auto-Classify: {task_name} - {timestamp}'),
});

// Discriminated union based on 'type'
const formSchema = z.discriminatedUnion('type', [
  baseSchema.merge(ingestConfigSchema),
  baseSchema.merge(classifyConfigSchema),
]);

// Infer the TypeScript type from the schema
type FormData = z.infer<typeof formSchema>;

// --- Helper Functions ---

// Updated mapInitialDataToForm
function mapInitialDataToForm(initialData: RecurringTask): FormData {
    const commonData = {
        name: initialData.name || '',
        description: initialData.description || '',
        schedule: initialData.schedule || '0 0 * * *',
    };
    const typedStatus: "active" | "paused" = initialData.status === 'active' ? 'active' : 'paused';

    if (initialData.type === 'ingest') {
        const config = initialData.configuration || {};
        const targetDatasourceId = typeof config.target_datasource_id === 'number' ? config.target_datasource_id : undefined;
        const sourceUrls = Array.isArray(config.source_urls) ? config.source_urls : [];
        const deduplicationStrategy = 'url_hash';

        // Construct object matching the INGEST schema variant *exactly*
        const ingestData: Extract<FormData, { type: 'ingest' }> = {
            ...commonData,
            type: 'ingest',
            status: typedStatus,
            config_target_datasource_id: targetDatasourceId,
            config_source_urls: sourceUrls,
            config_deduplication_strategy: deduplicationStrategy,
        };
        return ingestData;

    } else if (initialData.type === 'classify') {
        const config = initialData.configuration || {};
        const targetDataSourceIds = Array.isArray(config.target_datasource_ids) ? config.target_datasource_ids.map(Number) : [];
        const targetSchemeIds = Array.isArray(config.target_scheme_ids) ? config.target_scheme_ids.map(Number) : [];
        const processOnlyNew = typeof config.process_only_new === 'boolean' ? config.process_only_new : true;
        const jobNameTemplate = typeof config.job_name_template === 'string' ? config.job_name_template : 'Auto-Classify: {task_name} - {timestamp}';

        // Construct object matching the CLASSIFY schema variant *exactly*
        const classifyData: Extract<FormData, { type: 'classify' }> = {
            ...commonData,
            type: 'classify',
            status: typedStatus,
            config_target_datasource_ids: targetDataSourceIds,
            config_target_scheme_ids: targetSchemeIds,
            config_process_only_new: processOnlyNew,
            config_job_name_template: jobNameTemplate,
        };
        return classifyData;
    } else {
        // Fallback: Return a default *valid* FormData object (e.g., classify)
        console.warn("Unexpected initial data type:", initialData.type, "- defaulting to classify form.");
        const defaultClassifyData: FormData = {
            name: initialData.name || '',
            description: initialData.description || '',
            schedule: initialData.schedule || '0 0 * * *',
            status: typedStatus,
            type: 'classify',
            config_target_datasource_ids: [],
            config_target_scheme_ids: [],
            config_process_only_new: true,
            config_job_name_template: 'Auto-Classify: {task_name} - {timestamp}',
        };
        return defaultClassifyData;
    }
}


// --- Component Definition ---

interface RecurringTaskFormDialogProps {
  // Remove isOpen and onOpenChange props
  onSubmit: (taskData: RecurringTaskCreate | RecurringTaskUpdate) => Promise<void>;
  initialData?: RecurringTask;
  // onClose?: () => void; // Keep if needed for internal close logic
}

export default function RecurringTaskFormDialog({ // Remove isOpen, onOpenChange
  onSubmit,
  initialData
  // onClose
}: RecurringTaskFormDialogProps) {
  const isEditMode = !!initialData;
  const { dataSources } = useDataSourceStore();
  const { schemes: classificationSchemes } = useClassificationSystem({ autoLoadSchemes: true });

  const availableIngestSources = useMemo(
      () => dataSources.filter(ds =>
          ds.type === 'url_list' ||
          ds.type === 'text_block'
      ),
      [dataSources]
  );
  const availableClassifySources = useMemo(() => dataSources, [dataSources]);


  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: useMemo(() => {
       return initialData
         ? mapInitialDataToForm(initialData)
         : { // Default for create mode (classify)
              name: '',
              description: '',
              schedule: '0 0 * * *',
              status: 'paused',
              type: 'classify',
              config_target_datasource_ids: [],
              config_target_scheme_ids: [],
              config_process_only_new: true,
              config_job_name_template: 'Auto-Classify: {task_name} - {timestamp}',
         };
     }, [initialData]),
  });

   useEffect(() => {
      if (initialData) {
          form.reset(mapInitialDataToForm(initialData));
      } else {
           form.reset({
              name: '', description: '', schedule: '0 0 * * *', status: 'paused', type: 'classify',
              config_target_datasource_ids: [], config_target_scheme_ids: [], config_process_only_new: true,
              config_job_name_template: 'Auto-Classify: {task_name} - {timestamp}',
          });
      }
  }, [initialData, form]);


  const taskType = form.watch('type');

  const handleFormSubmit = async (data: FormData) => {
      console.log("[RecurringTaskFormDialog] Raw form data (data): ", data);
      let taskPayload: RecurringTaskCreate | RecurringTaskUpdate;

      // Construct payload based on the validated form data type
      if (data.type === 'ingest') {
          taskPayload = {
              name: data.name,
              description: data.description,
              type: data.type,
              schedule: data.schedule,
              status: data.status,
              configuration: {
                  target_datasource_id: data.config_target_datasource_id,
                  source_urls: data.config_source_urls,
                  deduplication_strategy: data.config_deduplication_strategy
              }
          };
      } else { // data.type === 'classify'
          taskPayload = {
              name: data.name,
              description: data.description,
              type: data.type,
              schedule: data.schedule,
              status: data.status,
              configuration: {
                  target_datasource_ids: data.config_target_datasource_ids,
                  target_scheme_ids: data.config_target_scheme_ids,
                  process_only_new: data.config_process_only_new,
                  job_name_template: data.config_job_name_template
              }
          };
      }

       console.log("[RecurringTaskFormDialog] Constructed task payload: ", taskPayload);

      try {
           console.log("Task Payload to Submit: ", taskPayload);
          await onSubmit(taskPayload);
          form.reset();
          // Closing is handled by parent's onOpenChange now
          // if (onClose) onClose(); // Call if passed and needed
      } catch (error) {
          console.error("Error during task submission:", error);
          toast.error("Submission Failed", { description: "Could not save the task. Please check the details and try again." });
      }
  };

  const onValidationError = (errors: any) => {
      console.error("Form Validation Errors:", errors);
      toast.error("Validation Failed", { description: "Please check the form for errors." });
  };


  // Renders ONLY the content, assumes parent Dialog provides structure
  return (
     <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
         <DialogHeader>
           <DialogTitle>{isEditMode ? 'Edit Recurring Task' : 'Create New Recurring Task'}</DialogTitle>
           <DialogDescription>
             Configure an automated task for data ingestion or classification.
           </DialogDescription>
         </DialogHeader>

         <Form {...form}>
           <form onSubmit={form.handleSubmit(handleFormSubmit, onValidationError)} className="space-y-4 py-4">

                {/* --- Common Fields --- */}
                <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                    <FormItem>
                        <FormLabel>Task Name</FormLabel>
                        <FormControl>
                        <Input placeholder="e.g., Daily News Ingest" {...field} />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                    )}
                />
                <FormField
                     control={form.control}
                     name="description"
                     render={({ field }) => (
                     <FormItem>
                         <FormLabel>Description (Optional)</FormLabel>
                         <FormControl>
                         <Textarea placeholder="Describe the purpose of this task..." {...field} value={field.value ?? ''}/>
                         </FormControl>
                         <FormMessage />
                     </FormItem>
                     )}
                />
                 <FormField
                      control={form.control}
                      name="schedule"
                      render={({ field }) => (
                      <FormItem>
                          <FormLabel>Cron Schedule</FormLabel>
                          <FormControl>
                          <Input placeholder="e.g., 0 5 * * *" {...field} />
                          </FormControl>
                          <FormDescription>
                             Standard cron format (minute hour day-of-month month day-of-week). Use <a href="https://crontab.guru/" target="_blank" rel="noopener noreferrer" className="underline">crontab.guru</a> for help.
                          </FormDescription>
                          <FormMessage />
                      </FormItem>
                      )}
                 />
                <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                        <FormItem className="space-y-3">
                        <FormLabel>Initial Status</FormLabel>
                        <FormControl>
                            <RadioGroup
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                            className="flex space-x-4"
                            >
                            <FormItem className="flex items-center space-x-2 space-y-0">
                                <FormControl>
                                <RadioGroupItem value="active" />
                                </FormControl>
                                <FormLabel className="font-normal">Active</FormLabel>
                            </FormItem>
                            <FormItem className="flex items-center space-x-2 space-y-0">
                                <FormControl>
                                <RadioGroupItem value="paused" />
                                </FormControl>
                                <FormLabel className="font-normal">Paused</FormLabel>
                            </FormItem>
                            </RadioGroup>
                        </FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                />

                 {/* --- Task Type Selection --- */}
                 <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Task Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isEditMode}>
                            <FormControl>
                            <SelectTrigger>
                                <SelectValue placeholder="Select task type" />
                            </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                             <SelectItem value="ingest">Ingest</SelectItem> {/* Enable Ingest */} 
                             <SelectItem value="classify">Classify</SelectItem>
                            </SelectContent>
                        </Select>
                        <FormDescription>
                             Choose the action this task will perform. Cannot be changed after creation.
                        </FormDescription>
                        <FormMessage />
                        </FormItem>
                    )}
                    />

                 {/* --- Configuration Fields (Conditional) --- */}
                {taskType === 'ingest' && (
                    <div className="space-y-4 p-4 border rounded bg-muted/30">
                        <h4 className="font-semibold text-sm">Ingest Configuration</h4>
                         <FormField
                            control={form.control}
                            name="config_target_datasource_id"
                            render={({ field }) => (
                                <FormItem>
                                <FormLabel>Target Data Source (for ingested records)</FormLabel>
                                <Select
                                    onValueChange={(value) => field.onChange(value ? parseInt(value, 10) : null)} // Handle null/undefined
                                    defaultValue={field.value?.toString() ?? ""}
                                >
                                    <FormControl>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select where to add records" />
                                    </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        <SelectItem value="">-- Select --</SelectItem> {/* Optional clear option */} 
                                    {availableIngestSources.map(ds => (
                                        <SelectItem key={ds.id} value={ds.id.toString()}>
                                        {ds.name} ({ds.type})
                                        </SelectItem>
                                    ))}
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                                </FormItem>
                            )}
                         />
                         <FormField
                            control={form.control}
                            name="config_source_urls"
                            render={({ field }) => (
                                <FormItem>
                                <FormLabel>Source URLs (one per line)</FormLabel>
                                <FormControl>
                                    <Textarea
                                        placeholder="https://example.com/article1\nhttps://anothersite.org/news"
                                        value={Array.isArray(field.value) ? field.value.join('\n') : ''}
                                        onChange={(e) => {
                                            const urls = e.target.value.split(/\r?\n/).map(url => url.trim()).filter(Boolean);
                                            field.onChange(urls);
                                        }}
                                        rows={5}
                                     />
                                </FormControl>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                 )}

                 {taskType === 'classify' && (
                    <div className="space-y-4 p-4 border rounded bg-muted/30">
                        <h4 className="font-semibold text-sm">Classification Configuration</h4>
                        <FormField
                             control={form.control}
                             name="config_target_datasource_ids"
                             render={({ field }) => (
                             <FormItem>
                                 <FormLabel>Target Data Sources</FormLabel>
                                 <ScrollArea className="h-32 w-full rounded-md border p-2">
                                 {availableClassifySources.map((ds) => (
                                     <FormField
                                        key={ds.id}
                                        control={form.control}
                                        name="config_target_datasource_ids"
                                        render={({ field: checkboxField }) => {
                                            const selectedIds = Array.isArray(checkboxField.value) ? checkboxField.value : [];
                                            return (
                                                <FormItem key={ds.id} className="flex flex-row items-center space-x-3 space-y-0 my-1">
                                                     <FormControl>
                                                        <Checkbox
                                                             checked={selectedIds.includes(ds.id)}
                                                             onCheckedChange={(checked) => {
                                                                const currentIds = Array.isArray(checkboxField.value) ? checkboxField.value : [];
                                                                return checked
                                                                 ? checkboxField.onChange([...currentIds, ds.id])
                                                                 : checkboxField.onChange(currentIds.filter((id) => id !== ds.id));
                                                             }}
                                                        />
                                                    </FormControl>
                                                    <FormLabel className="text-sm font-normal">
                                                         {ds.name} <span className="text-xs text-muted-foreground">({ds.type})</span>
                                                    </FormLabel>
                                                </FormItem>
                                             );
                                        }}
                                      />
                                ))}
                                </ScrollArea>
                                <FormMessage />
                             </FormItem>
                             )}
                        />
                        <FormField
                            control={form.control}
                            name="config_target_scheme_ids"
                            render={({ field }) => (
                                <FormItem>
                                <FormLabel>Classification Schemes</FormLabel>
                                <ScrollArea className="h-32 w-full rounded-md border p-2">
                                {classificationSchemes.map((scheme) => (
                                    <FormField
                                        key={scheme.id}
                                        control={form.control}
                                        name="config_target_scheme_ids"
                                        render={({ field: checkboxField }) => {
                                              const selectedIds = Array.isArray(checkboxField.value) ? checkboxField.value : [];
                                            return (
                                                <FormItem key={scheme.id} className="flex flex-row items-center space-x-3 space-y-0 my-1">
                                                <FormControl>
                                                    <Checkbox
                                                        checked={selectedIds.includes(scheme.id)}
                                                         onCheckedChange={(checked) => {
                                                            const currentIds = Array.isArray(checkboxField.value) ? checkboxField.value : [];
                                                            return checked
                                                            ? checkboxField.onChange([...currentIds, scheme.id])
                                                            : checkboxField.onChange(currentIds.filter((id) => id !== scheme.id));
                                                        }}
                                                    />
                                                </FormControl>
                                                <FormLabel className="text-sm font-normal">
                                                    {scheme.name}
                                                </FormLabel>
                                                </FormItem>
                                            );
                                        }}
                                     />
                                ))}
                                </ScrollArea>
                                <FormMessage />
                                </FormItem>
                            )}
                         />
                        <FormField
                            control={form.control}
                            name="config_process_only_new"
                            render={({ field }) => (
                                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm bg-background">
                                    <div className="space-y-0.5">
                                        <FormLabel>Process Only New Records</FormLabel>
                                        <FormDescription>
                                        If checked, only classify records created since the last successful run.
                                        </FormDescription>
                                    </div>
                                     <FormControl>
                                        <Checkbox
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                         />
                         <FormField
                              control={form.control}
                              name="config_job_name_template"
                              render={({ field }) => (
                              <FormItem>
                                  <FormLabel>Job Name Template (Optional)</FormLabel>
                                  <FormControl>
                                      <Input placeholder="Auto-Classify: {task_name} - {timestamp}" {...field} value={field.value ?? ''}/>
                                  </FormControl>
                                  <FormDescription>
                                      How automatically created jobs will be named. Use {'{task_name}'} and {'{timestamp}'}.
                                  </FormDescription>
                                  <FormMessage />
                              </FormItem>
                              )}
                         />
                    </div>
                 )}

                <DialogFooter>
                    <Button type="submit" disabled={form.formState.isSubmitting}>
                        {form.formState.isSubmitting ? 'Saving...' : (isEditMode ? 'Update Task' : 'Create Task')}
                    </Button>
                 </DialogFooter>
            </form>
         </Form>
     </DialogContent>
  );
}
