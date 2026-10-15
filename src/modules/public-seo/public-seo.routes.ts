import path from 'path';
import { Router } from 'express';
import type { RequestHandler } from 'express';
import { backendControllerPath } from '../legacy/legacy.paths';

const controller = require(path.join(backendControllerPath, 'publicSocialSeoController.js')) as Record<string, RequestHandler>;
const router = Router();

router.get('/recruitment/:code', controller.getPublicRecruitmentSeo);
router.get('/player-profile/:code', controller.getPublicPlayerProfileSeo);
router.get('/tournament/:code', controller.getPublicTournamentSeo);
router.get('/scrim/:code', controller.getPublicScrimSeo);

export default router;
