'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDatasetStore } from '@/zustand_stores/storeDatasets';
import { DatasetCreate } from '@/client/models';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface DatasetCreateDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => void;
    initialDatarecordIds?: number[];
    initialSchemeIds?: number[];
    initialJobIds?: number[];
}

const DatasetCreateDialog: React.FC<DatasetCreateDialogProps> = ({
    open,
    onOpenChange,
    onSuccess,
    initialDatarecordIds,
    initialSchemeIds,
    initialJobIds
}) => {
    const { createDataset } = useDatasetStore();
    const [isCreating, setIsCreating] = useState(false);
    const [formData, setFormData] = useState<Partial<DatasetCreate>>({
        name: '',
        description: '',
        custom_metadata: {},
        datarecord_ids: initialDatarecordIds || [],
        source_scheme_ids: initialSchemeIds || [],
        source_job_ids: initialJobIds || []
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsCreating(true);
        try {
            const dataset = await createDataset(formData as DatasetCreate);
            if (dataset) {
                onSuccess?.();
                onOpenChange(false);
                setFormData({
                    name: '',
                    description: '',
                    custom_metadata: {},
                    datarecord_ids: initialDatarecordIds || [],
                    source_scheme_ids: initialSchemeIds || [],
                    source_job_ids: initialJobIds || []
                });
            }
        } finally {
            setIsCreating(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Create New Dataset</DialogTitle>
                    <DialogDescription>
                        Create a new dataset to organize and manage your data.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <label htmlFor="name" className="text-sm font-medium">
                            Name
                        </label>
                        <Input
                            id="name"
                            value={formData.name}
                            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                            placeholder="Enter dataset name"
                            required
                        />
                    </div>
                    <div className="space-y-2">
                        <label htmlFor="description" className="text-sm font-medium">
                            Description
                        </label>
                        <Textarea
                            id="description"
                            value={formData.description || ''}
                            onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                            placeholder="Enter dataset description"
                            rows={3}
                        />
                    </div>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            disabled={isCreating}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isCreating || !formData.name}>
                            {isCreating ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Creating...
                                </>
                            ) : (
                                'Create Dataset'
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

export default DatasetCreateDialog; 