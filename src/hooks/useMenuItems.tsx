import {
  Settings,
  Code,
  MessagesSquare,
  WandSparkles,
  AudioLinesIcon,
  SquareSlashIcon,
  MonitorIcon,
  HomeIcon,
  PowerIcon,
  MailIcon,
  CoffeeIcon,
  GlobeIcon,
  BugIcon,
  MessageSquareTextIcon,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "@/contexts";
import { XIcon, GithubIcon } from "@/components";

export const useMenuItems = () => {
  const { hasActiveLicense } = useApp();

  const menu: {
    icon: React.ElementType;
    label: string;
    href: string;
    count?: number;
  }[] = [
    {
      icon: HomeIcon,
      label: "控制面板",
      href: "/dashboard",
    },
    {
      icon: MessagesSquare,
      label: "聊天记录",
      href: "/chats",
    },
    {
      icon: WandSparkles,
      label: "系统提示词",
      href: "/system-prompts",
    },
    {
      icon: Settings,
      label: "应用设置",
      href: "/settings",
    },
    {
      icon: MessageSquareTextIcon,
      label: "回复设置",
      href: "/responses",
    },
    {
      icon: MonitorIcon,
      label: "截图",
      href: "/screenshot",
    },
    {
      icon: AudioLinesIcon,
      label: "音频",
      href: "/audio",
    },
    {
      icon: SquareSlashIcon,
      label: "光标与快捷键",
      href: "/shortcuts",
    },

    {
      icon: Code,
      label: "服务配置",
      href: "/dev-space",
    },
  ];

  const footerItems = [
    ...(hasActiveLicense
      ? [
          {
            icon: MailIcon,
            label: "联系支持",
            href: "mailto:support@pluely.com",
          },
        ]
      : []),
    {
      icon: BugIcon,
      label: "反馈问题",
      href: "https://github.com/iamsrikanthnani/pluely/issues/new?template=bug-report.yml",
    },
    {
      icon: PowerIcon,
      label: "退出 Pluely",
      action: async () => {
        await invoke("exit_app");
      },
    },
  ];

  const footerLinks: {
    title: string;
    icon: React.ElementType;
    link: string;
  }[] = [
    {
      title: "官方网站",
      icon: GlobeIcon,
      link: "https://pluely.com",
    },
    {
      title: "Github",
      icon: GithubIcon,
      link: "https://github.com/iamsrikanthnani/pluely",
    },
    {
      title: "支持作者",
      icon: CoffeeIcon,
      link: "https://buymeacoffee.com/srikanthnani",
    },
    {
      title: "在 X 上关注",
      icon: XIcon,
      link: "https://x.com/srikanthnani",
    },
  ];

  return {
    menu,
    footerItems,
    footerLinks,
  };
};
