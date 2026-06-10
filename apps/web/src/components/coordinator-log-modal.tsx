import { coordinatorLogApi, type CoordinatorLog } from '@/lib/coordinator-log-api';
import { cn } from '@/lib/utils';
import { Loader2, ChevronDown, ChevronRight, CheckCircle2, XCircle, AlertCircle, Send, Bot, User, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { GroupAvatarImage } from '@/lib/group-avatars';
import { useChatStore } from '@/stores/chat-store';

const decisionLabelKeys: Record<string, string> = {
  dispatch: 'workbench.coordinatorDecisionDispatch',
  no_dispatch: 'workbench.coordinatorDecisionNoDispatch',
  ask_owner: 'workbench.coordinatorDecisionAskOwner',
  cannot_dispatch: 'workbench.coordinatorDecisionCannotDispatch',
};

const decisionColors: Record<string, string> = {
  dispatch: 'bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400',
  no_dispatch: 'bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  ask_owner: 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
  cannot_dispatch: 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400',
};

interface CoordinatorLogModalProps {
  open: boolean;
  onClose: () => void;
}

export function CoordinatorLogModal({ open, onClose }: CoordinatorLogModalProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const setScrollToMessageId = useChatStore((s) => s.setScrollToMessageId);
  const dateLocale = i18n.language === 'en-US' ? 'en-US' : 'zh-CN';

  // 点击日志卡片：切换到对应群聊并定位到触发消息
  const handleLogClick = (log: CoordinatorLog) => {
    navigate(`/?room=${log.chatRoomId}`);
    if (log.triggerMessageId) {
      setScrollToMessageId(log.triggerMessageId);
    }
    onClose();
  };
  const [logs, setLogs] = useState<Record<string, CoordinatorLog[]>>({});
  const [loading, setLoading] = useState(true);
  const [expandedRooms, setExpandedRooms] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      loadLogs();
    }
  }, [open]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const response = await coordinatorLogApi.getAll();
      if (response.success && response.data) {
        setLogs(response.data);
      } else {
        toast.error(response.error || t('workbench.loadCoordinatorLogsFailed'));
      }
    } finally {
      setLoading(false);
    }
  };

  const toggleRoom = (chatRoomId: string) => {
    setExpandedRooms((prev) => {
      const next = new Set(prev);
      if (next.has(chatRoomId)) {
        next.delete(chatRoomId);
      } else {
        next.add(chatRoomId);
      }
      return next;
    });
  };

  const chatRoomIds = Object.keys(logs).sort((a, b) => {
    const aLogs = logs[a];
    const bLogs = logs[b];
    if (!aLogs.length || !bLogs.length) return bLogs.length - aLogs.length;
    return new Date(bLogs[0].createdAt).getTime() - new Date(aLogs[0].createdAt).getTime();
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-2xl max-h-[80vh] rounded-lg border border-border bg-background shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-lg font-semibold text-foreground">{t('workbench.coordinatorLogs')}</h2>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto p-4" style={{ maxHeight: 'calc(80vh - 60px)' }}>
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="size-4 animate-spin mr-2" />
              {t('workbench.loadingCoordinatorLogs')}
            </div>
          ) : chatRoomIds.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t('workbench.noCoordinatorLogs')}
            </div>
          ) : (
            <div className="space-y-2">
              {chatRoomIds.map((chatRoomId) => {
                const roomLogs = logs[chatRoomId];
                const roomName = roomLogs[0]?.chatRoom?.name ?? t('workbench.coordinatorUnknownRoom');
                const isExpanded = expandedRooms.has(chatRoomId);

                return (
                  <div key={chatRoomId} className="rounded-lg border border-border bg-card">
                    <button
                      type="button"
                      onClick={() => toggleRoom(chatRoomId)}
                      className="flex w-full items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        {isExpanded ? (
                          <ChevronDown className="size-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="size-4 text-muted-foreground" />
                        )}
                        <GroupAvatarImage avatar={roomLogs[0]?.chatRoom?.avatar ?? null} className="size-5 rounded-full" />
                        <span className="font-medium text-foreground">{roomName}</span>
                        <span className="text-sm text-muted-foreground">{t('workbench.coordinatorLogCount', { num: roomLogs.length })}</span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        {t('workbench.coordinatorLogLatest', { time: new Date(roomLogs[0]?.createdAt).toLocaleString(dateLocale, { hour: '2-digit', minute: '2-digit' }) })}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-border px-4 py-3 space-y-2">
                        {roomLogs.map((log) => (
                          <div
                            key={log.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => handleLogClick(log)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleLogClick(log);
                              }
                            }}
                            className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2 transition-colors hover:bg-muted/60"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium', decisionColors[log.decision])}>
                                  {decisionLabelKeys[log.decision] ? t(decisionLabelKeys[log.decision]) : log.decision}
                                </span>
                                {log.success ? (
                                  <CheckCircle2 className="size-3.5 text-green-500" />
                                ) : (
                                  <XCircle className="size-3.5 text-red-500" />
                                )}
                              </div>

                              {log.decision === 'dispatch' && log.targetAgentIds && (
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Send className="size-3" />
                                  <span>{t('workbench.coordinatorTargetAgents', { num: log.targetAgentIds.length })}</span>
                                </div>
                              )}

                              {log.decision === 'ask_owner' && log.content && (
                                <div className="text-xs text-muted-foreground truncate max-w-md">
                                  {t('workbench.coordinatorQuestion', { content: log.content.slice(0, 100) })}
                                </div>
                              )}

                              {log.decision === 'cannot_dispatch' && log.reason && (
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <AlertCircle className="size-3" />
                                  <span>{t('workbench.coordinatorReason', { reason: log.reason === 'no_suitable_assistant' ? t('workbench.coordinatorReasonNoSuitableAssistant') : t('workbench.coordinatorReasonSystemManagement') })}</span>
                                </div>
                              )}

                              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                                {log.sourceAgent ? (
                                  <span className="flex shrink-0 items-center gap-1">
                                    <Bot className="size-3" />
                                    {log.sourceAgent.name}
                                  </span>
                                ) : (
                                  <User className="size-3 shrink-0" />
                                )}
                                <span className="min-w-0 flex-1 truncate">
                                  {log.sourceContent?.trim() || (log.sourceIsHuman ? t('workbench.coordinatorSourceUser') : t('workbench.coordinatorSourceAgent'))}
                                </span>
                              </div>
                            </div>

                            <div className="text-xs text-muted-foreground shrink-0">
                              {new Date(log.createdAt).toLocaleString(dateLocale, {
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}