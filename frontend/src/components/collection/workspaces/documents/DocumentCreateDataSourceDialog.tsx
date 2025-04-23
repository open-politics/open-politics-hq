'use client';

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useDataSourceStore } from '@/zustand_stores/storeDataSources';
import { DataSourceType } from '@/lib/classification/types'; // Use internal type
import { Loader2, UploadCloud, LinkIcon, FileText, X, FileUp, List, Type, Undo2, RefreshCcw } from 'lucide-react';
import { useToast } from "@/components/ui/use-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertTriangle } from "lucide-react"
import { cn } from '@/lib/utils';
import { Checkbox } from "@/components/ui/checkbox"
import { ChevronDown, ChevronUp } from "lucide-react"
import { UtilitiesService } from '@/client'; // Import the correct service
import { ScrapeArticleResponse } from '@/lib/scraping/scraping_response';
import { Switch } from '@/components/ui/switch';
import { useRecurringTasksStore, RecurringTaskCreate } from '@/zustand_stores/storeRecurringTasks';
import Cronstrue from 'cronstrue';

interface CreateDataSourceDialogProps {
  open: boolean;
  onClose: () => void;
  initialMode?: 'single' | 'bulk' | 'scrape'; 
}

// Add icons to the types
const dataSourceTypes: { value: DataSourceType; label: string; description: string; icon: React.ElementType }[] = [
  { value: 'csv', label: 'CSV File', description: 'Upload a comma-separated values file.', icon: FileUp },
  { value: 'pdf', label: 'PDF File', description: 'Upload a PDF document.', icon: FileUp }, // Can use same icon or different one
  { value: 'url_list', label: 'URL List', description: 'Provide a list of URLs to scrape.', icon: List },
  { value: 'text_block', label: 'Text Block', description: 'Paste or type raw text content.', icon: Type },
];

export default function CreateDataSourceDialog({ open, onClose, initialMode }: CreateDataSourceDialogProps) {
  const { createDataSource, isLoading, error: storeError } = useDataSourceStore();
  const { createRecurringTask } = useRecurringTasksStore();
  const { toast } = useToast();

  // --- State ---
  const [name, setName] = useState('');
  const [manualName, setManualName] = useState('');
  const [isNameAutoFilled, setIsNameAutoFilled] = useState(false);
  const [type, setType] = useState<DataSourceType>(dataSourceTypes[0].value);
  const [files, setFiles] = useState<File[]>([]);
  const [urls, setUrls] = useState<string>('');
  const [textContent, setTextContent] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);
  // NEW state for scraping title
  const [isScrapingTitle, setIsScrapingTitle] = useState(false);
  const [scrapeTitleError, setScrapeTitleError] = useState<string | null>(null);
  const [isNameAutoFilledFromUrl, setIsNameAutoFilledFromUrl] = useState(false);
  // NEW state for advanced CSV options
  const [showAdvancedCsv, setShowAdvancedCsv] = useState(false);
  const [skipRows, setSkipRows] = useState<string>('0'); // NEW: Number of initial rows to skip (0-based internally, user sees 0+)
  const [delimiter, setDelimiter] = useState<string>(','); // Default delimiter
  // NEW state for scheduled ingestion
  const [enableScheduledIngestion, setEnableScheduledIngestion] = useState(false);
  const [ingestionSchedule, setIngestionSchedule] = useState('0 0 * * *'); // Default: Daily midnight
  const [cronExplanation, setCronExplanation] = useState('');
  const [isSubmittingRecurring, setIsSubmittingRecurring] = useState(false); // Track second API call
  // --- End State ---

  const selectedTypeInfo = useMemo(() => dataSourceTypes.find(t => t.value === type), [type]);

  const resetForm = useCallback(() => {
    setName('');
    setManualName('');
    setIsNameAutoFilled(false);
    setType(dataSourceTypes[0].value);
    setFiles([]);
    setUrls('');
    setTextContent('');
    setFormError(null);
    // Reset advanced options
    setShowAdvancedCsv(false);
    setSkipRows('0'); // NEW: Reset skip rows
    setDelimiter(',');    // Reset to default
    // Reset scraping state
    setIsScrapingTitle(false);
    setScrapeTitleError(null);
    setIsNameAutoFilledFromUrl(false);
    // Reset scheduled ingestion state
    setEnableScheduledIngestion(false);
    setIngestionSchedule('0 0 * * *');
    setCronExplanation('');
    setIsSubmittingRecurring(false);
  }, []);

  const handleClose = () => {
    resetForm();
    onClose();
  };

  // Reset specific fields when type changes
  const handleTypeChange = (newType: DataSourceType) => {
    setType(newType);
    setFiles([]);
    setUrls('');
    setTextContent('');
    setFormError(null); // Clear errors on type change
    // Reset advanced options visibility if changing away from CSV
    if (newType !== 'csv') {
        setShowAdvancedCsv(false);
    }
    // Reset scrape state if changing away from URL list
    if (newType !== 'url_list') {
        setIsScrapingTitle(false);
        setScrapeTitleError(null);
        setIsNameAutoFilledFromUrl(false);
    }
    // Reset name only if it was auto-filled from a previous file upload
    if (isNameAutoFilled) {
        setName('');
        setManualName('');
        setIsNameAutoFilled(false);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files ? Array.from(event.target.files) : [];
    setFiles(selectedFiles);

    if (selectedFiles.length > 0) {
        // Clear URL-based autofill if file(s) are selected
        setIsNameAutoFilledFromUrl(false);

        // --- Name Autofill Logic for SINGLE file ONLY --- 
        if (selectedFiles.length === 1) {
            const selectedFile = selectedFiles[0];
            // Only auto-fill name if current name is empty or was previously auto-filled
            if (name.trim() === '' || isNameAutoFilled) {
                if (!isNameAutoFilled && name.trim() !== '') {
                   setManualName(name);
                } else if (!isNameAutoFilled && name.trim() === '') {
                   setManualName('');
                }
                const fileNameWithoutExtension = selectedFile.name.replace(/\.(csv|pdf)$/i, '');
                setName(fileNameWithoutExtension);
                setIsNameAutoFilled(true);
            } else {
                setManualName(name);
                setIsNameAutoFilled(false);
            }
        } else {
             // --- MULTIPLE FILES: Do NOT auto-fill, clear manual name backup --- 
             // User must provide a name for the batch/group OR rely on backend metadata naming
             if (isNameAutoFilled) {
                  setName(''); // Clear potentially auto-filled name
             }
             setIsNameAutoFilled(false);
             setManualName('');
        }
    } else {
         // No files selected, reset name state if it was auto-filled
         if (isNameAutoFilled) {
              setName('');
              setManualName('');
              setIsNameAutoFilled(false);
         }
    }
  };

  const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const newName = event.target.value;
      setName(newName);
      setIsNameAutoFilled(false);
      setIsNameAutoFilledFromUrl(false); // User is typing manually
      setManualName('');
  };

  const handleRevertName = () => {
      if (manualName) {
          setName(manualName);
          setIsNameAutoFilled(false);
          setManualName('');
      }
  }

  const validateForm = (): boolean => {
    setFormError(null);
    if (!name.trim()) {
      setFormError('Data Source name cannot be empty.');
      return false;
    }

    switch (type) {
      case 'csv':
        if (files.length === 0) {
          setFormError(`A CSV file is required.`);
          return false;
        }
        if (files.length > 1) {
             setFormError(`Only one CSV file can be uploaded at a time.`);
             return false;
        }
        // Validate advanced options if shown
        if (showAdvancedCsv) {
            // NEW: Validate skip_rows
            const skipRowsNum = parseInt(skipRows, 10);
            if (isNaN(skipRowsNum) || skipRowsNum < 0) {
                setFormError('Skip Initial Rows must be zero or a positive number (e.g., 0, 1, 2...).');
                return false;
            }
            if (!delimiter || delimiter.length !== 1) {
                setFormError('Delimiter must be a single character (e.g., ; | tab).');
                return false;
            }
        }
        break;
      case 'pdf':
        if (files.length === 0) {
          setFormError(`At least one PDF file is required.`);
          return false;
        }
        break;
      case 'url_list':
        const urlList = urls.split('\n').map(u => u.trim()).filter(Boolean);
        if (urlList.length === 0) {
          setFormError('At least one URL is required.');
          return false;
        }
        break;
      case 'text_block':
        if (!textContent.trim()) {
          setFormError('Text content cannot be empty.');
          return false;
        }
        break;
    }
    return true;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validateForm()) {
      return;
    }

    const formData = new FormData();
    formData.append('name', name);
    formData.append('type', type); // Type is guaranteed by selection buttons

    // Create originDetails separately, it might remain empty
    const originDetails: Record<string, any> = {};
    let sourceUrlList: string[] = []; // Keep track of URLs for recurring task config

    if (type === 'csv') {
        if (files.length === 1) {
            formData.append('file', files[0]); // Send single file with key 'file' for CSV
            // Append skip_rows and delimiter DIRECTLY to FormData if set
            if (showAdvancedCsv) {
                const skipRowsNum = parseInt(skipRows, 10);
                // Send skip_rows as a string, FastAPI handles conversion
                if (!isNaN(skipRowsNum) && skipRowsNum >= 0) {
                     formData.append('skip_rows', skipRows.toString()); // Send as string
                }
                if (delimiter && delimiter.length === 1) {
                     formData.append('delimiter', delimiter); // Send delimiter directly
                }
            }
        }
    } else if (type === 'pdf') {
        if (files.length > 0) {
            files.forEach((pdfFile, index) => {
               // Use the key 'files' for potentially multiple uploads
               formData.append('files', pdfFile, pdfFile.name);
            });
        }
    } else if (type === 'url_list') {
        sourceUrlList = urls.split('\n').map(u => u.trim()).filter(Boolean);
        originDetails.urls = sourceUrlList;
    } else if (type === 'text_block') {
        // Put text content *inside* originDetails JSON
        originDetails.text_content = textContent;
    }

    // Always append origin_details, even if it's empty
    // This ensures the field is present, even if it's just "{}"
    formData.append('origin_details', JSON.stringify(originDetails));


    // --- Call createDataSource ---
    const createdSource = await createDataSource(formData);

    if (createdSource) {
        toast({
            title: "Data Source Created",
            description: `Source "${createdSource.name}" added successfully and is now processing.`,
        });

        // --- NEW: Create Recurring Task if enabled --- 
        if (type === 'url_list' && enableScheduledIngestion) {
            setIsSubmittingRecurring(true);
            const recurringTaskPayload: RecurringTaskCreate = {
              name: `Scheduled Ingest: ${createdSource.name}`,
              description: `Automatically scrapes URLs for DataSource ${createdSource.name} (ID: ${createdSource.id})`,
              type: 'ingest',
              schedule: ingestionSchedule,
              configuration: { 
                  target_datasource_id: createdSource.id,
                  source_urls: sourceUrlList, // Use the URLs from the form
                  deduplication_strategy: 'url_hash' // Default or make configurable?
              },
              status: 'active' // Start as active if enabled
            };
            
            console.log("Attempting to create recurring task:", recurringTaskPayload);
            try {
                const createdRecurringTask = await createRecurringTask(recurringTaskPayload);
                if (createdRecurringTask) {
                    toast({
                        title: "Scheduled Ingestion Enabled",
                        description: `Task "${createdRecurringTask.name}" created. It will run first according to the schedule (${ingestionSchedule}).`,
                        variant: "default" // Use different variant?
                    });
                } else {
                     // createRecurringTask should handle its own errors/toasts via the store
                     toast({
                        title: "Scheduling Failed",
                        description: "Could not create the scheduled ingestion task automatically. Please create it manually if needed.",
                        variant: "destructive"
                    });
                }
            } catch (error) {
                 console.error("Error creating recurring task:", error);
                 toast({
                    title: "Scheduling Error",
                    description: "An unexpected error occurred while trying to create the scheduled ingestion task.",
                    variant: "destructive"
                });
            } finally {
                setIsSubmittingRecurring(false);
            }
        }
        // --- End NEW Section ---

        handleClose();
    } // Error handled via storeError display
  };

  // --- NEW: Effect to scrape title from first URL ---
  useEffect(() => {
      let isMounted = true;

      const tryScrapeTitle = async () => {
          // Conditions to attempt scraping:
          // 1. Type is URL list
          // 2. URLs input is not empty
          // 3. Name field is currently empty OR was previously autofilled (either by file or URL)
          const urlList = urls.split('\n').map(u => u.trim()).filter(Boolean);
          const firstUrl = urlList.length > 0 ? urlList[0] : null;

          if (
              type === 'url_list' &&
              firstUrl &&
              (name.trim() === '' || isNameAutoFilled || isNameAutoFilledFromUrl)
          ) {
              console.log("Attempting to scrape title for:", firstUrl);
              setIsScrapingTitle(true);
              setScrapeTitleError(null);
              try {
                  // Use the imported service
                  const response = await UtilitiesService.scrapeArticle({ url: firstUrl });
                  if (isMounted) {
                      let scrapedName = (response as ScrapeArticleResponse).title || 'Scraped Content'; // Use title or default
                      if (urlList.length > 1) {
                          scrapedName += ` + ${urlList.length - 1} others`; // Append count if multiple URLs
                      }
                      setName(scrapedName);
                      setIsNameAutoFilledFromUrl(true);
                      setIsNameAutoFilled(false); // Not from file
                      console.log("Scraped title and set name:", scrapedName);
                  }
              } catch (error: any) {
                  console.error("Error scraping title:", error);
                  if (isMounted) {
                      setScrapeTitleError("Could not fetch title from first URL.");
                      // Optionally clear name if scrape fails?
                      // setName('');
                      setIsNameAutoFilledFromUrl(false);
                  }
              } finally {
                  if (isMounted) {
                      setIsScrapingTitle(false);
                  }
              }
          } else {
              // If conditions aren't met (e.g., user typed name manually), ensure loading is off
              if (isScrapingTitle && isMounted) {
                 setIsScrapingTitle(false);
              }
          }
      };

      // Debounce the scrape attempt slightly
      const timeoutId = setTimeout(tryScrapeTitle, 500);

      return () => {
          isMounted = false;
          clearTimeout(timeoutId);
          // Optional: Cancel ongoing fetch if possible (depends on client library)
      };
  // Watch changes in type, urls, and whether the name was autofilled (from file)
  }, [type, urls, name, isNameAutoFilled, isNameAutoFilledFromUrl]); // Added name and isNameAutoFilledFromUrl dependencies

  // --- NEW: Update Cron Explanation --- 
  useEffect(() => {
    if (type !== 'url_list' || !enableScheduledIngestion) {
        setCronExplanation('');
        return;
    }
    try {
      const explanation = Cronstrue.toString(ingestionSchedule);
      setCronExplanation(explanation);
      // TODO: Consider adding specific validation error state for schedule if needed
    } catch (e) {
      setCronExplanation('Invalid cron format.');
    }
  }, [ingestionSchedule, type, enableScheduledIngestion]);

  const renderTypeSpecificInput = () => {
    switch (type) {
      case 'csv':
        return (
          <div className="space-y-3 p-4 border rounded-md bg-background">
            {/* File Input */}
            <Label htmlFor="file-upload" className="text-sm font-medium">Upload CSV File</Label>
            <div className="relative h-14">
              <Input
                id="file-upload"
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className={cn(files.length > 0 ? "opacity-0 pointer-events-none" : "")}
                disabled={isLoading}
                multiple
              />
              {files.length === 1 && (
                <div className="absolute inset-0 flex items-center justify-between text-sm p-3 bg-muted rounded-md border border-input">
                  <span className="truncate flex items-center gap-2">
                    <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground"/>
                    {files[0].name}
                  </span>
                  <Button
                    variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0"
                    onClick={(e) => {
                        e.preventDefault(); setFiles([]);
                        const fileInput = document.getElementById('file-upload') as HTMLInputElement;
                        if (fileInput) fileInput.value = '';
                    }}
                    disabled={isLoading} title="Remove file"
                  > <X className="h-4 w-4"/> </Button>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground pt-1"> {selectedTypeInfo?.description}</p>

            {/* Advanced Options Toggle */}
            <div className="pt-2">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAdvancedCsv(!showAdvancedCsv)}
                    className="text-xs h-7 px-2 text-muted-foreground hover:text-foreground"
                    disabled={isLoading}
                 >
                    {showAdvancedCsv ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
                    Advanced CSV Options
                 </Button>
            </div>

            {/* Advanced Options Fields */}
            {showAdvancedCsv && (
                 <div className="grid grid-cols-2 gap-4 pt-2 pl-2 border-l ml-1">
                     <div className="space-y-1">
                         <Label htmlFor="skip-rows" className="text-xs">Skip Initial Rows</Label>
                         <Input
                             id="skip-rows"
                             type="number"
                             min="0"
                             step="1"
                             value={skipRows}
                             onChange={(e) => setSkipRows(e.target.value)}
                             placeholder="e.g., 2"
                             className="h-8 text-xs"
                             disabled={isLoading}
                         />
                         <p className="text-xs text-muted-foreground">Number of rows to ignore at the start.</p>
                     </div>
                     <div className="space-y-1">
                         <Label htmlFor="delimiter" className="text-xs">Delimiter</Label>
                         <Input
                             id="delimiter"
                             type="text"
                             value={delimiter}
                             onChange={(e) => setDelimiter(e.target.value)}
                             placeholder="e.g., ; or \t for Tab"
                             className="h-8 text-xs"
                             disabled={isLoading}
                         />
                         {/* NEW: Helper buttons */}
                         <div className="flex items-center gap-1 pt-1">
                           <Button type="button" variant="outline" size="sm" className="px-1.5 h-5 text-xs" onClick={() => setDelimiter(',')} disabled={isLoading}>,</Button>
                           <Button type="button" variant="outline" size="sm" className="px-1.5 h-5 text-xs" onClick={() => setDelimiter(';')} disabled={isLoading}>;</Button>
                           <Button type="button" variant="outline" size="sm" className="px-1.5 h-5 text-xs" onClick={() => setDelimiter('\t')} disabled={isLoading}>Tab</Button>
                           <Button type="button" variant="outline" size="sm" className="px-1.5 h-5 text-xs" onClick={() => setDelimiter('|')} disabled={isLoading}>|</Button>
                         </div>
                          <p className="text-xs text-muted-foreground">Character separating columns (use button or type, e.g. \t for Tab).</p>
                     </div>
                 </div>
             )}
          </div>
        );
      case 'pdf':
        return (
          <div className="space-y-3 p-4 border rounded-md bg-background">
            <Label htmlFor="file-upload" className="text-sm font-medium">Upload PDF File</Label>
             <div className="relative h-14">
              <Input
                id="file-upload"
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                className={cn(files.length > 0 ? "opacity-0 pointer-events-none" : "")}
                disabled={isLoading}
                multiple
              />
              {files.length > 0 && (
                <div className="absolute inset-0 flex items-center justify-between text-sm p-3 bg-muted rounded-md border border-input">
                  <span className="truncate flex items-center gap-2">
                    <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground"/>
                    {files.length === 1 ? files[0].name : `${files.length} PDF files selected`}
                  </span>
                  <Button
                    variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0"
                    onClick={(e) => {
                        e.preventDefault(); setFiles([]);
                        const fileInput = document.getElementById('file-upload') as HTMLInputElement;
                        if (fileInput) fileInput.value = '';
                    }}
                    disabled={isLoading} title="Remove file"
                  > <X className="h-4 w-4"/> </Button>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground pt-1">{selectedTypeInfo?.description}</p>
          </div>
        );
      case 'url_list':
         return (
          <div className="space-y-3 p-4 border rounded-md bg-background">
            <div> 
              <Label htmlFor="urls" className="text-sm font-medium">URLs (one per line)</Label>
              <Textarea
                id="urls"
                placeholder="https://example.com/page1\nhttps://anothersite.org/article"
                value={urls}
                onChange={(e) => setUrls(e.target.value)}
                rows={8} className="text-sm" disabled={isLoading || isSubmittingRecurring}
              />
              <p className="text-xs text-muted-foreground pt-1">{selectedTypeInfo?.description}</p>
            </div>
            {/* --- NEW: Scheduled Ingestion Section --- */}
            <div className="pt-3 space-y-3 border-t">
                <div className="flex items-center justify-between space-x-2 pt-2">
                    <Label htmlFor="scheduled-ingestion-switch" className="flex flex-col space-y-1">
                        <span>Enable Scheduled Ingestion</span>
                        <span className="font-normal leading-snug text-muted-foreground text-xs">
                            Automatically re-scrape these URLs on a schedule to add new records.
                        </span>
                    </Label>
                    <Switch
                        id="scheduled-ingestion-switch"
                        checked={enableScheduledIngestion}
                        onCheckedChange={setEnableScheduledIngestion}
                        disabled={isLoading || isSubmittingRecurring}
                        aria-label="Enable Scheduled Ingestion"
                    />
                </div>
                {enableScheduledIngestion && (
                    <div className="space-y-1 pl-2 ml-1 border-l">
                        <Label htmlFor="ingestion-schedule" className="text-xs">Schedule (Cron Format)</Label>
                        <Input
                            id="ingestion-schedule"
                            value={ingestionSchedule}
                            onChange={(e) => setIngestionSchedule(e.target.value)}
                            placeholder="e.g., 0 0 * * *" 
                            className="h-8 text-xs"
                            disabled={isLoading || isSubmittingRecurring}
                        />
                        <p className="text-xs text-muted-foreground">
                             {cronExplanation || 'Enter a 5-part cron schedule.'} (Uses server timezone: UTC)
                        </p>
                         {/* TODO: Add link to cron editor/helper? */}
                    </div>
                )}
            </div>
            {/* --- End NEW Section --- */}
          </div>
        );
      case 'text_block':
        return (
          <div className="space-y-2 p-4 border rounded-md bg-background">
            <Label htmlFor="text-content" className="text-sm font-medium">Text Content</Label>
            <Textarea
              id="text-content"
              placeholder="Paste your text content here..."
              value={textContent}
              onChange={(e) => setTextContent(e.target.value)}
              rows={8} className="text-sm" disabled={isLoading}
            />
            <p className="text-xs text-muted-foreground pt-1">{selectedTypeInfo?.description}</p>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="sm:max-w-lg"> {/* Consider sm:max-w-xl if advanced options make it wide */}
        <DialogHeader>
          <DialogTitle>Create New Data Source</DialogTitle>
          <DialogDescription>
            Select the type of data source and provide the required information.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Name Input */}
          <div className="space-y-2">
            <Label htmlFor="name">Data Source Name</Label>
            <div className="flex items-center space-x-2">
              <Input
                id="name" value={name} onChange={handleNameChange}
                placeholder="e.g., Project Alpha Documents"
                disabled={isLoading} required className="flex-grow"
              />
              {isScrapingTitle && (
                 <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
              {(isNameAutoFilled && manualName) || isNameAutoFilledFromUrl && (
                 <Button type="button" variant="ghost" size="icon" onClick={handleRevertName} disabled={isLoading}
                   className="h-8 w-8 flex-shrink-0" title="Revert to manually entered name"
                 > <Undo2 className="h-4 w-4" /> </Button>
              )}
            </div>
          </div>

          {/* Type Selection */}
          <div className="space-y-2">
             <Label>Data Source Type</Label>
             <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {dataSourceTypes.map((t) => {
                    const Icon = t.icon;
                    return ( <Button key={t.value} type="button" variant={type === t.value ? "default" : "outline"}
                            onClick={() => handleTypeChange(t.value)} disabled={isLoading}
                            className="flex flex-col h-auto p-3 items-center justify-center text-center gap-1"
                        > <Icon className="h-5 w-5 mb-1" /> <span className="text-xs font-medium">{t.label}</span> </Button> );
                })}
             </div>
          </div>

          {/* Type Specific Inputs Area */}
          <div className="min-h-[180px]"> {/* Increased min height slightly for advanced options */}
             {renderTypeSpecificInput()}
          </div>

          {/* Error Display */}
          {formError && (
            <Alert variant="destructive"> <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Validation Error</AlertTitle> <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          {scrapeTitleError && (
            <Alert variant="default" className="text-orange-700 border-orange-300 bg-orange-50">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              <AlertTitle className="text-orange-800">Title Fetch Issue</AlertTitle>
              <AlertDescription>{scrapeTitleError}</AlertDescription>
            </Alert>
          )}
          {storeError && !formError && (
            <Alert variant="destructive"> <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Creation Error</AlertTitle> <AlertDescription>{storeError}</AlertDescription>
            </Alert>
          )}
          {/* End Error Display */}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose} disabled={isLoading || isSubmittingRecurring}>Cancel</Button>
            <Button type="submit" disabled={isLoading || isSubmittingRecurring || !type || !name.trim()}> 
              {(isLoading || isSubmittingRecurring) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isLoading ? 'Creating Source...' : (isSubmittingRecurring ? 'Scheduling...' : 'Create Source')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}