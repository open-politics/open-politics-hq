'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { AnnotationSchemaRead } from '@/client'
import withAuth from '@/hooks/withAuth'
import { useInfospaceStore } from '@/zustand_stores/storeInfospace'
import { useAssetDetail } from '@/components/collection/assets/Views/AssetDetailProvider'
import AnnotationSchemaCard from '@/components/collection/annotation/AnnotationSchemaCard'
import { SchemePreview } from '@/components/collection/annotation/schemaCreation/SchemePreview'
import { useHomeData } from '@/components/collection/home/useHomeData'
import { HomeIdentityRibbon } from '@/components/collection/home/HomeIdentityRibbon'
import { HomeInquiryBar } from '@/components/collection/home/HomeInquiryBar'
import { HomeAssetsPanel, HomeSchemasPanel } from '@/components/collection/home/HomeFoundation'
import { HomeAnalysisModule, HomeGraphsModule, HomePackagesModule } from '@/components/collection/home/HomeWork'

const fade = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] as const } },
}

/**
 * HQ home — a workspace surface, not a launcher. Reads top-to-bottom as
 * Foundation → Begin → Work: the materials you build from (Assets, Schemas) as
 * a left spine, one inquiry bar to begin (Find/Ask), and your living outputs
 * (favorited runs, recent graphs, packages) beside them.
 */
function HomePage() {
  const { activeInfospace, fetchInfospaces } = useInfospaceStore()
  const { openDetailOverlay, openBundleDetail } = useAssetDetail()
  const data = useHomeData()
  const [viewingSchema, setViewingSchema] = useState<AnnotationSchemaRead | null>(null)

  useEffect(() => { fetchInfospaces() }, [fetchInfospaces])

  return (
    <>
    <motion.div
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.06 } } }}
      className="flex h-full w-full flex-col gap-4 overflow-y-auto p-4 scrollbar-hide min-h-[91svh] md:min-h-[92.75svh] max-h-[92.75svh] sm:p-6"
    >
      <motion.div variants={fade}>
        <HomeIdentityRibbon
          name={activeInfospace?.name || ''}
          assets={data.assets.total}
          schemas={data.schemas.total}
          runs={data.analysis.total}
          embeddingsOn={data.embeddingsOn}
        />
      </motion.div>

      <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
        {/* Foundation spine */}
        <motion.aside variants={fade} className="order-2 flex flex-col gap-4 lg:order-1">
          <HomeAssetsPanel {...data.assets} onAssetClick={openDetailOverlay} onBundleClick={openBundleDetail} />
          <HomeSchemasPanel {...data.schemas} onSchemaClick={setViewingSchema} />
        </motion.aside>

        {/* Begin + Work */}
        <div className="order-1 flex flex-col gap-4 lg:order-2">
          <motion.div variants={fade}>
            <HomeInquiryBar />
          </motion.div>
          <motion.div variants={fade}>
            <HomeAnalysisModule favorites={data.analysis.favorites} isLoading={data.analysis.isLoading} />
          </motion.div>
          <div className="grid gap-4 sm:grid-cols-2">
            <motion.div variants={fade}>
              <HomeGraphsModule {...data.graphs} />
            </motion.div>
            <motion.div variants={fade}>
              <HomePackagesModule {...data.packages} />
            </motion.div>
          </div>
        </div>
      </div>
    </motion.div>

    <AnnotationSchemaCard
      show={!!viewingSchema}
      onClose={() => setViewingSchema(null)}
      title={viewingSchema ? `Schema: ${viewingSchema.name}` : 'Schema'}
      mode="watch"
    >
      {viewingSchema && <SchemePreview scheme={viewingSchema} />}
    </AnnotationSchemaCard>
    </>
  )
}

export default withAuth(HomePage)
